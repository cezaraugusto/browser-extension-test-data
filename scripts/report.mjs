#!/usr/bin/env node
// report.mjs: diff the latest matrix against baseline.json and emit a human
// report. This is what makes the testbed usable: hundreds of third-party
// extensions will never all pass, so we don't gate on green. We gate on CHANGE.
//
//   regression: was pass in baseline, now fail/timeout   → action required
//   progression: was fail in baseline, now pass            → extension.js improved
//   new: sample not in baseline                    → triage + record
//   removed: in baseline, gone upstream                → prune
//
// Flags:
//   --update    overwrite baseline.json with current verdicts (accept state)
//   --markdown  write reports/REPORT.md (for the weekly issue body)
import {ROOT, REPORTS_DIR, readJson, writeJson, loadSkips, fs, path} from './lib/util.mjs'

const SKIPS = loadSkips()

const args = process.argv.slice(2)
const baselineArg = (() => {
  const i = args.indexOf('--baseline')
  return i >= 0 && args[i + 1] ? args[i + 1] : 'baseline.json'
})()
// Per-platform baselines: macOS/Safari verdicts differ from Linux, so the
// Safari lane gates against its own file (e.g. baseline.safari.json).
const BASELINE = path.isAbsolute(baselineArg) ? baselineArg : path.join(ROOT, baselineArg)

function verdictKey(browsers) {
  // collapse per-browser statuses into a stable comparable string.
  // `skip` is environment-dependent (e.g. safari off macOS), so it never counts
  // as pass or fail: it's excluded from the comparable key entirely.
  const parts = Object.entries(browsers)
    .filter(([, v]) => v.status !== 'skip')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([b, v]) => `${b}=${v.status}`)
  return parts.length ? parts.join(',') : 'skip'
}

// Framework health: of the samples Extension.js is responsible for (everything not
// on the sample-side/upstream skip list), how many build cleanly. A non-skipped
// failure is a real product problem; a skipped one is the sample's fault.
function frameworkHealth(results) {
  const attempted = results.filter((r) => !SKIPS[r.id])
  const failures = attempted.filter((r) => !isPass(verdictKey(r.browsers)))
  return {
    total: results.length,
    skipped: results.length - attempted.length,
    attempted: attempted.length,
    pass: attempted.length - failures.length,
    failures: failures.map((r) => r.id)
  }
}

function isPass(key) {
  return key !== 'skip' && !/=fail|=timeout/.test(key)
}

function main() {
  const latest = readJson(path.join(REPORTS_DIR, 'latest.json'))
  const baseline = readJson(BASELINE, {samples: {}})
  const base = baseline.samples || {}

  // Skip-listed samples are forced to 'skip' regardless of how the run recorded
  // them, so sample-side faults never count as framework fail/regression.
  const current = {}
  for (const r of latest.results) current[r.id] = SKIPS[r.id] ? 'skip' : verdictKey(r.browsers)

  const regressions = []
  const progressions = []
  const added = []

  for (const r of latest.results) {
    const cur = current[r.id]
    const prev = base[r.id]
    if (prev === undefined) {
      added.push({id: r.id, verdict: cur})
    } else if (prev !== cur) {
      if (isPass(prev) && !isPass(cur)) regressions.push({id: r.id, from: prev, to: cur})
      else if (!isPass(prev) && isPass(cur)) progressions.push({id: r.id, from: prev, to: cur})
      // pass→pass or fail→fail with different detail: drift, not gated
    }
  }
  const removed = Object.keys(base).filter((id) => current[id] === undefined)

  const framework = frameworkHealth(latest.results)

  const diff = {
    generatedAt: new Date().toISOString(),
    cli: latest.cli,
    cliVersion: latest.cliVersion,
    platform: latest.platform,
    tier: latest.tier,
    totals: latest.totals,
    framework,
    regressions,
    progressions,
    added,
    removed
  }
  writeJson(path.join(REPORTS_DIR, 'diff.json'), diff)

  if (args.includes('--update')) {
    writeJson(BASELINE, {
      updatedAt: new Date().toISOString(),
      cli: latest.cli,
      cliVersion: latest.cliVersion,
      platform: latest.platform,
      browsers: latest.browsers,
      samples: current
    })
    console.log(`baseline.json updated with ${Object.keys(current).length} samples`)
  }

  if (args.includes('--markdown')) fs.writeFileSync(path.join(REPORTS_DIR, 'REPORT.md'), markdown(diff))

  console.log(
    `Regressions: ${regressions.length}  Progressions: ${progressions.length}  New: ${added.length}  Removed: ${removed.length}`
  )
  for (const r of regressions) console.log(`  ✗ REGRESSION ${r.id}: ${r.from} → ${r.to}`)

  const f = framework
  const pct = ((f.pass / f.attempted) * 100).toFixed(1)
  console.log(
    `\nFramework health on ${latest.cliVersion}: ${f.pass}/${f.attempted} buildable samples pass (${pct}%)` +
      `  ·  ${f.skipped} skipped (sample-side/upstream)  ·  ${f.failures.length} framework failures`
  )
  for (const id of f.failures) console.log(`  ✗ FRAMEWORK FAIL ${id}`)

  // Fail CI only on regressions, so the weekly job goes red exactly when the
  // shipped CLI got worse at building real extensions.
  if (regressions.length > 0) process.exitCode = 1
}

function table(rows) {
  return rows.length ? rows.map((r) => `- \`${r.id}\`: ${r.from || r.verdict}${r.to ? ` → ${r.to}` : ''}`).join('\n') : '_none_'
}

function markdown(d) {
  return `# Browser Extension Test Data: Weekly QA

**CLI under test:** \`${d.cli}\` (resolved \`${d.cliVersion}\`)
**Platform:** ${d.platform} · **Tier:** ${d.tier}
**Run:** ${d.generatedAt}

## Framework health
**${d.framework.pass}/${d.framework.attempted}** buildable samples pass (**${((d.framework.pass / d.framework.attempted) * 100).toFixed(1)}%**) · ${d.framework.skipped} skipped (sample-side/upstream) · **${d.framework.failures.length} framework failures**
${d.framework.failures.length ? d.framework.failures.map((id) => `- ❌ \`${id}\``).join('\n') : '_none: Extension.js builds every buildable sample_'}

## Totals (raw, incl. skips)
\`\`\`json
${JSON.stringify(d.totals, null, 2)}
\`\`\`

## 🔴 Regressions (${d.regressions.length})
${table(d.regressions)}

## 🟢 Progressions (${d.progressions.length})
${table(d.progressions)}

## 🆕 New samples (${d.added.length})
${table(d.added)}

## 🗑️ Removed upstream (${d.removed.length})
${d.removed.length ? d.removed.map((id) => `- \`${id}\``).join('\n') : '_none_'}
`
}

main()
