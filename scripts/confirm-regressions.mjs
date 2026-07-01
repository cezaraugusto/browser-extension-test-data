#!/usr/bin/env node
// confirm-regressions.mjs — the "don't page on a flake" gate.
//
// After report.mjs writes reports/diff.json, this re-runs ONLY the regressing
// samples (in isolation, freshly staged) up to N times. A regression that clears
// on any re-run was flaky infrastructure (transient npm/registry/network), not a
// real product regression, so it's dropped. Only regressions that fail every
// re-run are "confirmed" — and only those should open a weekly issue.
//
// Exits non-zero iff any confirmed regression remains. Writes
// reports/confirmed-regressions.json.
import {spawnSync} from 'node:child_process'
import {ROOT, REPORTS_DIR, readJson, writeJson, path} from './lib/util.mjs'

const ATTEMPTS = Number(process.env.QA_CONFIRM_ATTEMPTS || 2)
const CONFIRM_OUT = path.join(REPORTS_DIR, 'confirm.json')

function verdictFails(browsers) {
  // fails if any non-skip browser is fail/timeout
  return Object.values(browsers).some((v) => v.status === 'fail' || v.status === 'timeout')
}

function rerun(ids, browsers) {
  const r = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'run-matrix.mjs'),
      '--only',
      ids.join(','),
      '--install',
      '--browsers',
      browsers.join(','),
      '--out',
      CONFIRM_OUT,
      '--concurrency',
      '3'
    ],
    {cwd: ROOT, stdio: 'inherit'}
  )
  if (r.status !== 0) return null
  return readJson(CONFIRM_OUT).results
}

function main() {
  const diff = readJson(path.join(REPORTS_DIR, 'diff.json'), {regressions: []})
  const latest = readJson(path.join(REPORTS_DIR, 'latest.json'))
  const browsers = latest.browsers || ['chrome', 'firefox', 'edge']

  let suspects = diff.regressions.map((r) => r.id)
  if (suspects.length === 0) {
    writeJson(path.join(REPORTS_DIR, 'confirmed-regressions.json'), {confirmed: [], cleared: []})
    console.log('No regressions to confirm.')
    return
  }

  console.log(`Confirming ${suspects.length} regression(s) over up to ${ATTEMPTS} re-run(s): ${suspects.join(', ')}`)
  const cleared = []
  for (let attempt = 1; attempt <= ATTEMPTS && suspects.length; attempt++) {
    const results = rerun(suspects, browsers)
    if (!results) {
      console.error(`Re-run attempt ${attempt} failed to execute; keeping suspects as-is.`)
      break
    }
    const byId = Object.fromEntries(results.map((r) => [r.id, r]))
    const stillFailing = []
    for (const id of suspects) {
      const r = byId[id]
      if (r && !verdictFails(r.browsers)) {
        cleared.push({id, clearedOnAttempt: attempt})
        console.log(`  ✓ cleared (flaky): ${id} passed on re-run ${attempt}`)
      } else {
        stillFailing.push(id)
      }
    }
    suspects = stillFailing
  }

  const confirmed = suspects
  writeJson(path.join(REPORTS_DIR, 'confirmed-regressions.json'), {confirmed, cleared})
  console.log(`\nConfirmed regressions: ${confirmed.length}  ·  cleared as flaky: ${cleared.length}`)
  for (const id of confirmed) console.log(`  ✗ CONFIRMED REGRESSION ${id}`)

  if (confirmed.length > 0) process.exitCode = 1
}

main()
