#!/usr/bin/env node
// run-matrix.mjs: the core QA pass.
//
// For every discovered sample, build it with the resolved Extension.js CLI per
// target browser and record a verdict (pass | fail | timeout | skip).
//
// CRITICAL: isolated staging: Extension.js walks UP from a sample to the nearest
// project root (the source repo's package.json/.git) and writes dist/ + installs
// node_modules THERE. Building samples in place would make every sample in a
// source share one output dir and clobber each other under concurrency. So each
// sample is copied into its own throwaway dir under .work/ and built in isolation.
//
// Tiers:
//   raw: build as-is (EXTENSION_SKIP_INSTALL).
//   install: `npm install` in the staged dir first (only when --install given),
//              for samples carrying a bundler/build step. Without --install they
//              are recorded as skip:needs-install so they never count as failures.
//
// Browsers: chrome,firefox,edge by default. safari is macOS/Xcode-only and is
// recorded as skip:non-macos elsewhere.
//
// Flags: --browsers a,b  --source id  --tier raw|install|all  --install
//        --runtime  --concurrency n  --limit n
import {spawn} from 'node:child_process'
import os from 'node:os'
import {ROOT, REPORTS_DIR, readJson, writeJson, pool, execAsync, exec, ensureDir, loadSkips, fs, path} from './lib/util.mjs'
import {resolveCli, cliArgs} from './lib/cli.mjs'
import {checkManifestAssets} from './lib/integrity.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const has = (n) => argv.includes(`--${n}`)

const BROWSERS = flag('browsers', 'chrome,firefox,edge').split(',')
const ONLY_SOURCE = flag('source', null)
const ONLY_IDS = flag('only', null) // comma-separated sample ids (for confirm re-runs)
const OUT = flag('out', null) // write report here instead of latest.json (confirm re-runs)
const TIER = flag('tier', 'raw') // raw | install | all
const DO_INSTALL = has('install') || TIER === 'install'
const CONCURRENCY = Number(flag('concurrency', process.env.QA_CONCURRENCY || 4))
const LIMIT = Number(flag('limit', 0))
const BUILD_TIMEOUT = Number(process.env.QA_BUILD_TIMEOUT_MS || 180_000)
const INSTALL_TIMEOUT = Number(process.env.QA_INSTALL_TIMEOUT_MS || 300_000)
const DEV_TIMEOUT = Number(process.env.QA_DEV_TIMEOUT_MS || 60_000)
const IS_MAC = os.platform() === 'darwin'
const CHECK_INTEGRITY = !has('no-integrity')

// Stage OUTSIDE the repo tree. Extension.js walks up from a sample to the nearest
// project root (package.json/.git); staging inside this package would make it
// resolve THIS package as the root and build with the wrong context. A neutral
// OS temp dir has no project-root ancestor, so each sample builds in true isolation.
const WORK = path.join(os.tmpdir(), 'extension-qa-work')
const XDG = process.env.XDG_CONFIG_HOME || path.join(ROOT, '.xdg-config')
ensureDir(XDG)
const baseEnv = {...process.env, XDG_CONFIG_HOME: XDG, CI: '1', EXTENSION_TELEMETRY: '0'}

function snippet(text, n = 600) {
  const t = (text || '').replace(/\x1b\[[0-9;]*m/g, '').trim()
  return t.length > n ? t.slice(-n) : t
}

// Copy a sample into its own isolated work dir so its build output and any
// installed deps never touch the shared source clone or sibling samples.
function stage(sample) {
  const dest = path.join(WORK, sample.id.replace(/[\\/]/g, '__'))
  fs.rmSync(dest, {recursive: true, force: true})
  fs.mkdirSync(dest, {recursive: true})
  const r = exec('cp', ['-R', sample.path + '/.', dest])
  if (!r.ok) throw new Error(`stage failed: ${r.stderr}`)
  return dest
}

async function build(cli, dir, browser, env) {
  // Retry once on a hard build failure to absorb transient blips (npx cold-cache
  // races on fresh CI runners, network). A deterministic failure fails both tries.
  let r
  for (let attempt = 1; attempt <= 2; attempt++) {
    r = await execAsync(cli.command, cliArgs(cli, 'build', ['--browser', browser, '--silent']), {
      cwd: dir,
      env,
      timeoutMs: BUILD_TIMEOUT
    })
    if (r.ok) break
    if (attempt < 2) fs.rmSync(path.join(dir, 'dist'), {recursive: true, force: true})
  }
  if (!r.ok) return {status: r.timedOut ? 'timeout' : 'fail', ms: r.ms, error: snippet(r.stderr || r.stdout)}
  // Build exited 0: assert the emitted manifest's referenced files were all emitted.
  // A green build that drops declared assets is a silent failure (see lib/integrity.mjs).
  if (CHECK_INTEGRITY) {
    const {ok, missing} = checkManifestAssets(path.join(dir, 'dist', browser))
    if (!ok) return {status: 'fail', reason: 'missing-assets', ms: r.ms, error: `missing-assets: ${missing.join(', ')}`}
  }
  return {status: 'pass', ms: r.ms, error: null}
}

// Populate the npx/CLI cache once before the concurrent pool, so a fresh runner's
// first parallel builds don't race to install the CLI into a cold shared cache.
function prewarm(cli) {
  try {
    exec(cli.command, [...cli.prefix, '--help'], {timeout: 120_000})
  } catch {
    /* best-effort */
  }
}

// Tier 2: boot dev, resolve when the CLI prints a ready marker, then kill.
function devSmoke(cli, dir, browser, env) {
  return new Promise((resolve) => {
    const child = spawn(cli.command, cliArgs(cli, 'dev', ['--browser', browser]), {cwd: dir, env})
    let out = ''
    const start = Date.now()
    const done = (status, error) => {
      clearTimeout(timer)
      try { child.kill('SIGKILL') } catch {}
      resolve({status, ms: Date.now() - start, error})
    }
    const timer = setTimeout(() => done('timeout', 'no ready marker'), DEV_TIMEOUT)
    const onData = (d) => {
      out += d
      if (/ready in|compiled successfully|watching for changes|running .* in/i.test(out)) done('pass', null)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (e) => done('fail', String(e)))
    child.on('close', (code) => done(code === 0 ? 'pass' : 'fail', snippet(out)))
  })
}

function selectTier(sample) {
  if (TIER === 'all') return true
  if (TIER === 'install') return sample.tier === 'install'
  return sample.tier === 'raw'
}

async function processSample(cli, sample) {
  const browsers = {}
  // Sample-side / upstream failures are not Extension.js's fault: skip building
  // them entirely so the framework pass-rate isn't polluted (reasons in skips.json).
  const skip = SKIPS[sample.id]
  if (skip && !has('no-skips')) {
    for (const b of BROWSERS) browsers[b] = {status: 'skip', reason: skip.category}
    return {id: sample.id, source: sample.source, tier: sample.tier, skipped: skip.category, browsers, runtime: null}
  }
  let dir
  try {
    dir = stage(sample)
  } catch (e) {
    for (const b of BROWSERS) browsers[b] = {status: 'fail', error: String(e.message)}
    return {id: sample.id, source: sample.source, tier: sample.tier, browsers, runtime: null}
  }

  const env = {...baseEnv}
  let installFailed = null
  if (sample.tier === 'install') {
    if (DO_INSTALL) {
      // NB: no --prefer-offline — it resolves against stale cached registry
      // metadata and spuriously ETARGETs on just-published transitive deps.
      // Retry once to absorb transient registry/network blips (flaky-install guard).
      let r
      for (let attempt = 1; attempt <= 2; attempt++) {
        r = await execAsync('npm', ['install', '--no-audit', '--no-fund'], {cwd: dir, env, timeoutMs: INSTALL_TIMEOUT})
        if (r.ok) break
      }
      if (!r.ok) installFailed = snippet(r.stderr || r.stdout)
    } else {
      env.EXTENSION_SKIP_INSTALL = '1'
    }
  } else {
    env.EXTENSION_SKIP_INSTALL = '1'
  }

  for (const b of BROWSERS) {
    if (b === 'safari' && !IS_MAC) { browsers[b] = {status: 'skip', reason: 'non-macos'}; continue }
    if (sample.tier === 'install' && !DO_INSTALL) { browsers[b] = {status: 'skip', reason: 'needs-install'}; continue }
    if (installFailed) { browsers[b] = {status: 'fail', error: `install: ${installFailed}` }; continue }
    browsers[b] = await build(cli, dir, b, env)
  }

  let runtime = null
  if (has('runtime') && RUNTIME_SET.has(sample.id)) {
    runtime = {}
    for (const b of BROWSERS) {
      if (b === 'safari' && !IS_MAC) { runtime[b] = {status: 'skip', reason: 'non-macos'}; continue }
      runtime[b] = await devSmoke(cli, dir, b, env)
    }
  }

  fs.rmSync(dir, {recursive: true, force: true})
  return {id: sample.id, source: sample.source, tier: sample.tier, manifestVersion: sample.manifestVersion, browsers, runtime}
}

let RUNTIME_SET = new Set()
const SKIPS = loadSkips()

async function main() {
  fs.rmSync(WORK, {recursive: true, force: true})
  ensureDir(WORK)
  const cli = resolveCli()
  // --only bypasses the tier filter so a confirm re-run can target any id directly.
  const onlySet = ONLY_IDS ? new Set(ONLY_IDS.split(',').map((s) => s.trim())) : null
  let work = readJson(path.join(REPORTS_DIR, 'samples.json')).samples.filter(
    (s) => s.valid && (onlySet ? onlySet.has(s.id) : selectTier(s))
  )
  if (ONLY_SOURCE) work = work.filter((s) => s.source === ONLY_SOURCE)
  // Sort by id so a run (and especially --limit) selects the SAME samples on every
  // platform — filesystem readdir order differs between macOS and Linux otherwise.
  work.sort((a, b) => a.id.localeCompare(b.id))
  if (LIMIT > 0) work = work.slice(0, LIMIT)
  RUNTIME_SET = new Set(has('runtime') ? readJson(path.join(ROOT, 'runtime.json'), {samples: []}).samples : [])

  const effectiveBrowsers = BROWSERS.filter((b) => b !== 'safari' || IS_MAC)
  console.log(`CLI: ${cli.label}  |  tier=${TIER}  install=${DO_INSTALL}  |  ${work.length} samples × [${BROWSERS.join(', ')}]${!IS_MAC && BROWSERS.includes('safari') ? ' (safari→skip)' : ''}  |  concurrency ${CONCURRENCY}`)
  prewarm(cli)

  let done = 0
  const results = await pool(work, CONCURRENCY, async (sample) => {
    const r = await processSample(cli, sample)
    done++
    const flat = Object.entries(r.browsers).map(([b, v]) => `${b}:${v.status}`).join(' ')
    process.stdout.write(`[${done}/${work.length}] ${r.id}: ${flat}\n`)
    return r
  })

  const report = {
    generatedAt: new Date().toISOString(),
    cli: cli.label,
    cliVersion: cli.version,
    platform: os.platform(),
    tier: TIER,
    browsers: BROWSERS,
    integrity: CHECK_INTEGRITY, // recorded so report.mjs can fingerprint scoring criteria
    totals: summarize(results, effectiveBrowsers),
    results
  }
  ensureDir(REPORTS_DIR)
  if (OUT) {
    // Targeted confirm re-run: write only to the requested path, don't clobber latest.json.
    writeJson(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), report)
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    writeJson(path.join(REPORTS_DIR, `matrix-${stamp}.json`), report)
    writeJson(path.join(REPORTS_DIR, 'latest.json'), report)
  }
  fs.rmSync(WORK, {recursive: true, force: true})
  console.log(`\n${JSON.stringify(report.totals, null, 2)}`)
}

function summarize(results, browsers) {
  const t = {samples: results.length}
  for (const b of browsers) {
    t[b] = {pass: 0, fail: 0, timeout: 0, skip: 0}
    for (const r of results) {
      const st = r.browsers[b]?.status || 'skip'
      t[b][st] = (t[b][st] || 0) + 1
    }
  }
  return t
}

main()
