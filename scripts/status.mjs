#!/usr/bin/env node
// status.mjs — the single "are we clean?" verdict.
//
// Reads reports/diff.json (framework health, regressions, criteria skew) and, if
// present, reports/confirmed-regressions.json (regressions that survived a re-run).
// Renders a CLEAN / NOT CLEAN summary to stdout and — under GitHub Actions — to the
// job summary ($GITHUB_STEP_SUMMARY), so the run page and the README badge show the
// verdict at a glance.
//
//   CLEAN            0 framework failures AND 0 confirmed regressions → exit 0 (green)
//   NOT CLEAN        a framework failure or a confirmed regression    → exit 1 (red)
//   RE-BASELINE      scoring criteria changed since baseline          → exit 0 (neutral)
import {REPORTS_DIR, readJson, fs, path} from './lib/util.mjs'

function main() {
  const diff = readJson(path.join(REPORTS_DIR, 'diff.json'), null)
  if (!diff) {
    console.error('No reports/diff.json — run `npm run report` first.')
    process.exitCode = 2
    return
  }
  const confirmed = readJson(path.join(REPORTS_DIR, 'confirmed-regressions.json'), null)
  // Prefer the confirmed (re-run-filtered) list; fall back to the raw diff.
  const regressions = confirmed ? confirmed.confirmed : diff.regressions.map((r) => r.id)
  const f = diff.framework
  const skew = diff.criteriaSkew

  const clean = f.failures.length === 0 && regressions.length === 0
  const verdict = skew ? '⚠️ RE-BASELINE NEEDED' : clean ? '✅ CLEAN' : '❌ NOT CLEAN'
  const pct = ((f.pass / f.attempted) * 100).toFixed(1)

  const lines = [
    `# ${verdict} · ${diff.cliVersion}`,
    '',
    `**Framework health:** ${f.pass}/${f.attempted} buildable samples pass (${pct}%) · ${f.skipped} skipped (sample-side/upstream)`,
    `**Framework failures:** ${f.failures.length}${f.failures.length ? '\n' + f.failures.map((id) => `- ❌ \`${id}\``).join('\n') : ''}`,
    `**Confirmed regressions:** ${regressions.length}${regressions.length ? '\n' + regressions.map((id) => `- 🔴 \`${id}\``).join('\n') : ''}`,
    `**Progressions:** ${diff.progressions.length} · **Criteria:** \`${diff.criteria.hash}\`${skew ? ' (changed: re-baseline required, not a regression)' : ''}`
  ]
  const summary = lines.join('\n') + '\n'

  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)

  // Skew is not a product problem — don't fail the job on it (re-baseline instead).
  if (!clean && !skew) process.exitCode = 1
}

main()
