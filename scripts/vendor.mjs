#!/usr/bin/env node
// vendor.mjs: promote a validated upstream snapshot into the tracked corpus.
//
// The tracked corpus dirs (mdn/, chrome/, extension.js/, chromium/) are the
// repo's data product: a browsable, pinned copy of every sample the harness is
// responsible for, consumable by downstream test suites without network or a
// sync step. The pipeline itself tests upstream-latest in .cache/; this script
// is the promotion gate between the two:
//
//   sync -> qa run -> CLEAN verdict -> vendor -> commit
//
// Vendoring copies each source's scan trees (plus `vendorInclude` extras) from
// .cache/<id> into `vendorDir`, preserving the upstream-relative layout so
// sample ids match cache-mode discovery exactly. Provenance lands next to the
// data in <vendorDir>/VENDORED.json: repo, ref, the exact SHA vendored, and a
// deterministic tree hash so later runs can prove the corpus wasn't hand-edited.
//
// Sources marked `vendorFrozen` (chromium: upstream is a monorepo we don't
// sync yet) are never copied; they get a one-time provenance stamp over the
// existing tracked dir and are hash-verified like everything else.
//
// Modes:
//   node scripts/vendor.mjs                  vendor every enabled source with a vendorDir
//   node scripts/vendor.mjs --source id      vendor one source
//   node scripts/vendor.mjs --check          verify tree hashes (tamper => exit 1)
//                                            and report vendored-SHA vs lock drift
import crypto from 'node:crypto'
import {ROOT, CACHE_DIR, loadSources, exec, readJson, writeJson, fs, path} from './lib/util.mjs'

const LOCK = path.join(ROOT, 'sources.lock.json')
// Never legitimately part of a sample; pruned at any depth.
const PRUNE_ANY = new Set(['.git', 'node_modules'])
// OS noise: never copied, never hashed (a local Finder visit must not flip --check).
const IGNORE_FILES = new Set(['.DS_Store', 'VENDORED.json'])

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const ONLY = (() => {
  const i = argv.indexOf('--source')
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(',') : null
})()

function vendorable() {
  return loadSources().filter(
    (s) => s.vendorDir && (!ONLY || ONLY.includes(s.id))
  )
}

// Deterministic content hash of a vendored tree: sorted posix-relative paths +
// file bytes, VENDORED.json itself excluded. Proves the tracked data is exactly
// what vendor.mjs wrote (hand-edits to vendored samples silently fork upstream).
function treeHash(dir) {
  const files = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.isFile()) files.push(abs)
    }
  }
  walk(dir)
  const h = crypto.createHash('sha1')
  let count = 0
  let bytes = 0
  for (const abs of files) {
    const rel = path.relative(dir, abs).split(path.sep).join('/')
    if (rel === 'VENDORED.json' || IGNORE_FILES.has(path.basename(abs))) continue
    const buf = fs.readFileSync(abs)
    h.update(rel)
    h.update('\0')
    h.update(buf)
    count++
    bytes += buf.length
  }
  return {hash: h.digest('hex').slice(0, 16), files: count, bytes}
}

// Copy `srcDir` into `destDir`, pruning PRUNE_ANY at any depth and `pruneTop`
// dir names at the top level only. Top-level ignore entries in sources.json
// mean repo-level noise (_archive, .github, celtic_diary_data); deeper dirs
// with the same names can be legitimate sample content and must survive, so
// samples stay byte-faithful to upstream.
function copyTree(srcDir, destDir, pruneTop) {
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src)
      if (IGNORE_FILES.has(base)) return false
      if (PRUNE_ANY.has(base)) {
        try {
          if (fs.statSync(src).isDirectory()) return false
        } catch {
          return false
        }
      }
      if (path.dirname(src) === srcDir && pruneTop.includes(base)) {
        try {
          return !fs.statSync(src).isDirectory()
        } catch {
          return false
        }
      }
      return true
    }
  })
}

function vendorOne(src, lock) {
  const dest = path.join(ROOT, src.vendorDir)

  if (src.vendorFrozen) {
    // Frozen corpus: never copied, only stamped once so --check can guard it.
    if (!fs.existsSync(dest)) {
      console.error(`✗ ${src.id}: frozen vendorDir ${src.vendorDir}/ missing`)
      return false
    }
    const stamp = path.join(dest, 'VENDORED.json')
    if (fs.existsSync(stamp)) {
      console.log(`✓ ${src.id}: frozen, already stamped (${src.vendorDir}/)`)
      return true
    }
    const t = treeHash(dest)
    writeJson(stamp, {
      source: src.id,
      name: src.name,
      repo: src.repo,
      frozen: true,
      note: src.note || 'Frozen snapshot: upstream sync not wired for this source.',
      vendoredAt: new Date().toISOString(),
      treeHash: t.hash,
      files: t.files,
      bytes: t.bytes
    })
    console.log(`✓ ${src.id}: stamped frozen snapshot (${t.files} files)`)
    return true
  }

  const entry = lock[src.id]
  if (!entry) {
    console.error(`✗ ${src.id}: no sources.lock.json entry (run sync first)`)
    return false
  }
  const cache = path.join(CACHE_DIR, src.id)
  const head = exec('git', ['rev-parse', 'HEAD'], {cwd: cache})
  if (!head.ok || head.stdout.trim() !== entry.sha) {
    console.error(
      `✗ ${src.id}: .cache clone is not at the locked SHA (${entry.sha.slice(0, 10)}); run sync, re-run the matrix, then vendor`
    )
    return false
  }

  const ignore = src.ignore || []
  fs.rmSync(dest, {recursive: true, force: true})
  fs.mkdirSync(dest, {recursive: true})

  const trees = [...src.scan, ...(src.vendorInclude || [])]
  for (const tree of trees) {
    const from = path.join(cache, tree)
    if (!fs.existsSync(from)) {
      console.error(`✗ ${src.id}: scan tree ${tree} missing upstream`)
      return false
    }
    const to = tree === '.' ? dest : path.join(dest, tree)
    copyTree(from, to, ignore)
  }
  // Carry upstream license/readme when the scan trees don't already include them.
  for (const f of ['LICENSE', 'LICENSE.md', 'README.md']) {
    const from = path.join(cache, f)
    const to = path.join(dest, f)
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to)
  }

  const t = treeHash(dest)
  writeJson(path.join(dest, 'VENDORED.json'), {
    source: src.id,
    name: src.name,
    repo: src.repo,
    ref: entry.ref,
    sha: entry.sha,
    vendoredAt: new Date().toISOString(),
    scan: src.scan,
    vendorInclude: src.vendorInclude || [],
    prunedTopLevel: ignore,
    treeHash: t.hash,
    files: t.files,
    bytes: t.bytes
  })
  console.log(`✓ ${src.id}: vendored ${entry.sha.slice(0, 10)} -> ${src.vendorDir}/ (${t.files} files, ${(t.bytes / 1e6).toFixed(1)} MB)`)
  return true
}

// --check: recompute every tree hash (tamper detection, gating) and compare the
// vendored SHA against sources.lock.json (drift is informational: refreshing the
// corpus is a deliberate vendor+commit after a CLEAN run, not an auto-update).
function check() {
  const lock = readJson(LOCK, {})
  const rows = []
  let tampered = 0
  for (const src of vendorable()) {
    const dest = path.join(ROOT, src.vendorDir)
    if (!fs.existsSync(dest)) {
      rows.push({id: src.id, status: 'missing-dir'})
      tampered++
      continue
    }
    const stamp = readJson(path.join(dest, 'VENDORED.json'), null)
    if (!stamp) {
      rows.push({id: src.id, status: 'unstamped'})
      tampered++
      continue
    }
    const t = treeHash(dest)
    const intact = t.hash === stamp.treeHash
    if (!intact) tampered++
    let drift = null
    if (!stamp.frozen && lock[src.id]) {
      drift = lock[src.id].sha === stamp.sha ? 'in-sync' : `behind (lock ${lock[src.id].sha.slice(0, 10)}, vendored ${stamp.sha.slice(0, 10)})`
    }
    rows.push({
      id: src.id,
      status: intact ? 'intact' : `TAMPERED (hash ${t.hash} != stamped ${stamp.treeHash})`,
      drift: stamp.frozen ? 'frozen' : drift || 'no-lock',
      files: t.files
    })
  }
  for (const r of rows) {
    console.log(`${r.status === 'intact' ? '✓' : '✗'} ${r.id}: ${r.status}${r.drift ? `  |  ${r.drift}` : ''}${r.files ? `  |  ${r.files} files` : ''}`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      '## Vendored corpus',
      '',
      '| Source | Integrity | Drift vs lock | Files |',
      '|---|---|---|---|',
      ...rows.map((r) => `| ${r.id} | ${r.status} | ${r.drift || ''} | ${r.files || ''} |`)
    ].join('\n')
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
  }
  if (tampered) {
    console.error(`\n${tampered} corpus dir(s) failed integrity: vendored data must only change via vendor.mjs + commit`)
    process.exit(1)
  }
  console.log('\nVendored corpus intact.')
}

function main() {
  if (CHECK) return check()
  const lock = readJson(LOCK, {})
  let ok = true
  for (const src of vendorable()) ok = vendorOne(src, lock) && ok
  if (!ok) process.exit(1)
}

main()
