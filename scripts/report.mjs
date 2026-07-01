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
import crypto from 'node:crypto'
import {ROOT, REPORTS_DIR, readJson, writeJson, loadSkips, fs, path} from './lib/util.mjs'

const SKIPS = loadSkips()

// A baseline is only comparable to a run scored under the SAME rules. This
// fingerprints the scoring criteria (integrity on/off, target browsers, skip
// list); if it changes, a pass→fail is the harness getting stricter, not the
// product regressing — so we require a re-baseline instead of firing a false
// regression (this is what produced the issue-#2 false alarms).
function criteriaFingerprint(latest) {
  const criteria = {
    integrity: latest.integrity !== false,
    browsers: [...(latest.browsers || [])].sort(),
    skips: Object.keys(SKIPS).sort()
  }
  const hash = crypto.createHash('sha1').update(JSON.stringify(criteria)).digest('hex').slice(0, 12)
  return {hash, ...criteria}
}

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
  // --no-baseline: report framework health on whatever ran (e.g. a push smoke
  // subset) without diffing a full-corpus baseline — avoids spurious skew/removed.
  const baseline = args.includes('--no-baseline') ? {samples: {}} : readJson(BASELINE, {samples: {}})
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

  // Criteria-skew guard: if the baseline was recorded under different scoring
  // rules, its pass/fail verdicts aren't comparable — suppress regressions and
  // ask for a re-baseline rather than paging on a stricter check.
  const criteria = criteriaFingerprint(latest)
  const criteriaSkew = base && baseline.criteria && baseline.criteria.hash !== criteria.hash
  if (criteriaSkew) {
    regressions.length = 0
    progressions.length = 0
  }

  const diff = {
    generatedAt: new Date().toISOString(),
    cli: latest.cli,
    cliVersion: latest.cliVersion,
    platform: latest.platform,
    tier: latest.tier,
    criteria,
    criteriaSkew: Boolean(criteriaSkew),
    baselineCriteria: baseline.criteria || null,
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
      criteria, // scoring-rules fingerprint — future runs compare against this
      samples: current
    })
    console.log(`baseline.json updated with ${Object.keys(current).length} samples (criteria ${criteria.hash})`)
  }

  if (args.includes('--markdown')) fs.writeFileSync(path.join(REPORTS_DIR, 'REPORT.md'), markdown(diff))

  if (criteriaSkew) {
    console.log(
      `⚠️  Criteria changed since baseline (baseline ${baseline.criteria.hash} → run ${criteria.hash}). ` +
        `Regression check suppressed — run "npm run baseline:update" to re-baseline under the new rules.`
    )
  }
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
**Platform:** ${d.platform} · **Tier:** ${d.tier} · **Criteria:** \`${d.criteria.hash}\`
**Run:** ${d.generatedAt}
${d.criteriaSkew ? `\n> ⚠️ **Criteria changed since baseline** (\`${d.baselineCriteria && d.baselineCriteria.hash}\` → \`${d.criteria.hash}\`). Regression check suppressed — re-baseline required, not a product regression.\n` : ''}

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
