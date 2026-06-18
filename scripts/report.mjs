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
import {ROOT, REPORTS_DIR, readJson, writeJson, fs, path} from './lib/util.mjs'

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
  return Object.entries(browsers)
    .filter(([, v]) => v.status !== 'skip')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([b, v]) => `${b}=${v.status}`)
    .join(',')
}

function main() {
  const latest = readJson(path.join(REPORTS_DIR, 'latest.json'))
  const baseline = readJson(BASELINE, {samples: {}})
  const base = baseline.samples || {}

  const current = {}
  for (const r of latest.results) current[r.id] = verdictKey(r.browsers)

  const regressions = []
  const progressions = []
  const added = []

  const isPass = (key) => !/=fail|=timeout/.test(key)

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

  const diff = {
    generatedAt: new Date().toISOString(),
    cli: latest.cli,
    cliVersion: latest.cliVersion,
    platform: latest.platform,
    tier: latest.tier,
    totals: latest.totals,
    regressions,
    progressions,
    added,
    removed
  }
  writeJson(path.join(REPORTS_DIR, 'diff.json'), diff)

  if (args.includes('--update')) {
    writeJson(BASELINE, {updatedAt: new Date().toISOString(), cli: latest.cli, samples: current})
    console.log(`baseline.json updated with ${Object.keys(current).length} samples`)
  }

  if (args.includes('--markdown')) fs.writeFileSync(path.join(REPORTS_DIR, 'REPORT.md'), markdown(diff))

  console.log(
    `Regressions: ${regressions.length}  Progressions: ${progressions.length}  New: ${added.length}  Removed: ${removed.length}`
  )
  for (const r of regressions) console.log(`  ✗ REGRESSION ${r.id}: ${r.from} → ${r.to}`)

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

## Totals
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
