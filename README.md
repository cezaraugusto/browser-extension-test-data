# Browser Extension Test Data

[![Weekly QA](https://github.com/cezaraugusto/browser-extension-test-data/actions/workflows/weekly-qa.yml/badge.svg)](https://github.com/cezaraugusto/browser-extension-test-data/actions/workflows/weekly-qa.yml)
[![Smoke](https://github.com/cezaraugusto/browser-extension-test-data/actions/workflows/smoke.yml/badge.svg)](https://github.com/cezaraugusto/browser-extension-test-data/actions/workflows/smoke.yml)

Real-world proof that [Extension.js](https://github.com/extension-js/extension.js) builds the extensions people actually ship.

Every week this testbed pulls hundreds of live browser-extension samples straight from their upstream repositories (MDN, Chrome, Chromium, Edge, Opera, and the Extension.js examples) and builds each one with the published Extension.js CLI. One question, answered on a schedule: can the framework take an extension it did not author and build it, unchanged, across Chrome, Firefox, and Edge? The badges above are the live answer.

## Why this exists

A framework is only as good as the real projects it can run. Synthetic fixtures pass; production extensions surprise you. So instead of hand-written test cases, this repo tests against the actual sample corpuses developers learn from and copy. When a release breaks one of them, we know before users do.

The result is a single, honest signal: **framework health**. Of the samples Extension.js is responsible for, how many build correctly right now?

## How it works

```
sources.json ─▶ sync ─▶ discover ─▶ run-matrix ─▶ report ─▶ status
   registry     clone     find        build every    diff vs      CLEAN /
   of repos     + pin     samples      sample per     baseline     NOT CLEAN
               the SHA    + classify   browser        + guards      verdict
```

| Stage | What it does |
|-------|--------------|
| **sync** | Fetches the latest commit of each source, shallow-clones it into `.cache/` (gitignored, never vendored), and pins the tested SHA in `sources.lock.json`. |
| **discover** | Walks each clone, records every extension sample, and classifies it (manifest version, `chrome.*` vs `browser.*`, entrypoints, whether it needs a build step). |
| **run-matrix** | Builds each sample per target browser in an isolated workspace and records `pass` / `fail` / `timeout` / `skip`, plus the exact CLI version under test. |
| **report** | Diffs the run against `baseline.json` and computes framework health. |
| **status** | Prints the one verdict that matters: `CLEAN` or `NOT CLEAN`, with the numbers behind it. |

## Framework health, not "all green"

Hundreds of third-party extensions will never all build, and that is fine. Some reference their own pre-built output, some ship CSS pointing at assets they forgot to include, one even commits invalid JavaScript upstream. Those live in `skips.json` with a category and a hand-verified reason, and they are excluded from the score.

What is left is the number worth trusting:

```
✅ CLEAN · 4.0.3
Framework health: 212/212 buildable samples pass (100.0%) · 9 skipped (sample-side/upstream)
Framework failures: 0 · Confirmed regressions: 0
```

A non-skipped failure is a real product defect. A skipped one is the sample's problem, not the framework's. Run `--no-skips` to build the skipped samples anyway, for example to check whether upstream fixed one.

## Verdicts you can trust

The gate stays quiet unless something is genuinely wrong. Four mechanisms make that true:

- **Isolated builds.** Every sample is staged into its own throwaway workspace before building, so parallel builds never share an output directory or resolve the wrong project root.
- **Asset integrity.** A build that exits `0` can still drop files the manifest declares. After each passing build, the emitted `manifest.json` is checked against `dist/`; a missing icon or theme image flips the verdict to `fail:missing-assets`. This caught five broken themes that exit codes alone called green.
- **Criteria fingerprint.** A baseline is only comparable to a run scored under the same rules. `baseline.json` stores a hash of those rules, and when they change the report asks for a re-baseline instead of firing a false regression.
- **Confirm before alerting.** Before the weekly job opens an issue, it re-runs only the regressing samples. Anything that clears on a retry was flaky infrastructure and is dropped. Only failures that survive every retry count.

## Usage

```sh
npm run qa       # full pipeline: sync, discover, build the corpus, report, verdict
npm run smoke    # fast slice for a quick health check
npm run status   # print the current CLEAN / NOT CLEAN verdict
npm run sync     # refresh upstream clones and the lock
npm run discover # rebuild the sample list

npm run baseline:update  # accept the current run as the new baseline
```

Scope a run when you need to:

```sh
node scripts/run-matrix.mjs --source mdn --browsers chrome,firefox
node scripts/run-matrix.mjs --tier install --install --source extensionjs
node scripts/run-matrix.mjs --limit 20
```

Targets are `chrome`, `firefox`, and `edge` on Linux. `safari` builds through Xcode and runs on macOS only; elsewhere it records `skip:non-macos`.

## Which CLI gets tested

By default the testbed runs the published `extension@latest`, the exact version users install. Override it to gate a release early or to try an unreleased build:

| Setting | Effect |
|---------|--------|
| _(default)_ | `extension@latest`, the shipped CLI. |
| `EXTENSION_TAG=canary` | test the next release before it publishes. |
| `EXTENSION_CLI_PATH=/abs/cli.cjs` | test a local, unreleased build. |

Every report records the resolved version (for example `4.0.3`), so a regression always maps to a specific release.

## Add a source

Extend the corpus by adding one entry to `sources.json`. No code changes:

```json
{
  "id": "edge",
  "name": "Microsoft Edge extension samples",
  "repo": "https://github.com/MicrosoftEdge/MicrosoftEdge-Extensions",
  "ref": "main",
  "api": "chrome",
  "scan": ["."],
  "ignore": ["node_modules", "build", "dist"],
  "enabled": true
}
```

`scan` picks the directories to search, `ignore` prunes the walk, and `enabled: false` registers a candidate without running it yet.

## Automation

Two workflows keep the badges honest:

- **Smoke** runs on every push and pull request that touches the testbed. It builds a fast, deterministic slice and posts a `CLEAN` / `NOT CLEAN` verdict in minutes.
- **Weekly QA** runs Mondays at 06:00 UTC (and on demand). It builds the full corpus against `extension@latest`, renders the verdict to the run summary, and opens an issue only when a regression survives a re-run.

## License

MIT
