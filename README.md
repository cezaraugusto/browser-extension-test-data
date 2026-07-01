# Browser Extension Test Data

[![Weekly QA](https://github.com/cezaraugusto/browser-extension-test-data/actions/workflows/weekly-qa.yml/badge.svg)](https://github.com/cezaraugusto/browser-extension-test-data/actions/workflows/weekly-qa.yml)

> Automated QA testbed. Fetches real-world browser-extension samples from their
> upstream repositories every week and verifies that [Extension.js](https://github.com/extension-js/extension.js)
> can build and run them, the same way it builds the first-party examples.

The headline question this answers: **can the published Extension.js CLI take an
extension it did not author (straight from MDN, Chrome, Chromium, Edge, Opera)
and build it unchanged?** Regressions in that answer are caught automatically.

## How it works

```
sources.json ──▶ sync ──▶ discover ──▶ run-matrix ──▶ report
   registry      clone      find every    extension      diff vs
   of upstream   + pin SHA  manifest.json build <s>      baseline.json
   repos         (.cache/)  + classify    --browser b    → regressions
```

| Stage | Script | What it does |
|-------|--------|--------------|
| **sync** | `scripts/sync.mjs` | For each enabled source, `git ls-remote` the latest SHA, shallow-clone into `.cache/<id>` (gitignored, never vendored), pin the tested SHA in `sources.lock.json`, and report which sources changed since last run. |
| **discover** | `scripts/discover.mjs` | Enumerate samples per source `layout` (see below), classify each (manifest version incl. vendor-prefixed keys, `chrome.*` vs `browser.*`, entrypoints, `raw` vs `install` tier). → `reports/samples.json`. |
| **run-matrix** | `scripts/run-matrix.mjs` | Stage each sample into an isolated temp dir, then `extension build --browser <b>` per target browser; record `pass`/`fail`/`timeout`/`skip` and the resolved CLI version. → `reports/latest.json`. |
| **report** | `scripts/report.mjs` | Diff `latest.json` against `baseline.json`. Exits non-zero (CI red) **only on regressions**. → `reports/diff.json` + `reports/REPORT.md`. |

### Two things that make verdicts trustworthy

**Isolated staging.** Extension.js resolves the project root by walking *up* from a
sample to the nearest `package.json`/`.git`, and writes `dist/` + installs deps
there. So the matrix copies every sample into its own dir under the OS temp
directory (outside this repo) before building; otherwise samples in one source
would share an output dir and clobber each other, and a sample staged inside this
package would wrongly resolve *this package* as its root. (Both were real bugs.)

**Asset integrity.** Exit code 0 isn't enough; a build can succeed while silently
dropping files the manifest declares. After every passing build, `run-matrix` reads the
*emitted* `dist/<browser>/manifest.json` and asserts every local file it references
(icons, theme images, content scripts, web-accessible resources, HTML entrypoints, …)
actually exists in `dist/`; if not, the verdict becomes `fail:missing-assets`. This
caught 5 themes whose images were never emitted (4 of them scored "green" by exit code
alone, see `bug-reports/05-…`). Disable with `--no-integrity`.

**Layout-aware discovery.** `sources.json` `layout` controls enumeration:
`manifest-root` (MDN/Chrome: a sample is any dir directly holding `manifest.json`)
vs `project-root` (Extension.js examples: each child of `scan` is a sample whose
manifest lives at `src/manifest.json`; building from `src/` instead of the project
root strips the loader config and produces phantom failures).

### Build tiers

`discover` tags each sample `raw` (no deps) or `install` (carries a `package.json`
build step). `run-matrix --tier all --install` builds the whole corpus in one pass:
install-tier samples get `npm install` first, raw samples build as-is. Without
`--install`, install-tier samples are recorded `skip:needs-install` so they never
count as failures.

### Framework health vs. sample-side skips

Not every failure is Extension.js's fault: some samples reference their own pre-built
`dist/` output, ship CSS pointing at absent assets, or (in one case) commit invalid JS
upstream. Those live in `skips.json` with a category + hand-verified reason. The matrix
records them as `skip` (doesn't build them), and the report excludes them so the headline
number (**framework health**) answers exactly one question: *of the samples Extension.js
is responsible for, how many build correctly?* A non-skipped failure is a real product
defect; a skipped one is the sample's. `report` prints e.g.

```
Framework health on 3.18.4-canary.322.7da5ffe: 212/212 buildable samples pass (100.0%)
  · 9 skipped (sample-side/upstream) · 0 framework failures
```

Run with `--no-skips` to build the skip-listed samples anyway (e.g. to re-check whether
upstream fixed one). Removing an entry from `skips.json` lets a sample re-enter the matrix.

### Why a baseline instead of "all green"

Hundreds of third-party extensions will never all build; many use bundler steps,
native-messaging hosts, or conventions Extension.js doesn't (yet) support. So we
don't gate on green. We gate on **change**:

- **regression**: built last week, fails now → CI red, issue opened.
- **progression**: failed last week, builds now → Extension.js improved.
- **new / removed**: upstream added/deleted a sample → triage and re-baseline.

`baseline.json` is the accepted state. After reviewing a run, run
`npm run baseline:update` to record current verdicts.

### Guarding against false regressions

Two guards keep the weekly gate from paging on non-regressions:

**Criteria fingerprint (baseline/harness skew).** A baseline is only comparable to a
run scored under the same rules. `baseline.json` stores a `criteria` hash of the
scoring inputs (integrity on/off, target browsers, skip list). If a run's criteria
differ — e.g. a new check makes things stricter — `report` **suppresses regressions**
and prints *"criteria changed — re-baseline required"* (exits 0) instead of firing a red
alarm. This is what caused the early false-regression issue: the integrity check was
added but the baseline predated it, so `pass → fail` read as a regression when the
product hadn't changed.

**Confirm-before-alert (flaky infra).** Before the weekly job opens an issue,
`scripts/confirm-regressions.mjs` re-runs *only* the regressing samples (up to
`QA_CONFIRM_ATTEMPTS`, default 2). Any that clear on re-run were transient
infrastructure (npm/registry/network) and are dropped; the issue opens only on
regressions that survive every re-run. The workflow gates on this step, not on the
raw report.

## Usage

```sh
npm run qa            # full pipeline: sync → discover → matrix → report
npm run sync          # just refresh upstream clones + lock
npm run discover      # just rebuild the sample list
npm run matrix        # full corpus: --tier all --install --browsers chrome,firefox,edge
npm run matrix:smoke  # fast 12-sample raw slice for a sanity check
npm run baseline:update   # accept current verdicts as the new baseline
```

Scope a run:

```sh
node scripts/run-matrix.mjs --source mdn --browsers chrome,firefox --concurrency 6
node scripts/run-matrix.mjs --tier install --install --source extensionjs   # deps + build
node scripts/run-matrix.mjs --limit 20        # cap sample count
```

Targets: `chrome`, `firefox`, `edge` (Chromium/Gecko, run on Linux). `safari`
builds via Xcode and runs only on macOS; elsewhere it records `skip:non-macos`.
The weekly workflow runs a gating Linux lane (chrome/firefox/edge → `baseline.json`)
and a non-gating macOS lane (adds safari → `baseline.safari.json`).

### Which CLI is tested

Resolved in `scripts/lib/cli.mjs`, mirroring the first-party examples repo:

| Env | Effect |
|-----|--------|
| _(none)_ | `npx -y extension@latest` (what users get, cron default). |
| `EXTENSION_TAG=canary` | test the next release before publish. |
| `EXTENSION_CLI_PATH=/abs/cli.cjs` | test an unreleased local build. |

## Adding a source

Append to `sources.json`, no code changes:

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

`scan` lists directories to search (each top-most `manifest.json` = one sample);
`ignore` prunes the walk. Set `enabled: false` to register a candidate without
running it. Edge/Opera/Chromium ship disabled with notes until their upstream
URLs are confirmed (Chromium needs a sparse-checkout strategy; see its note).

## Automation

`.github/workflows/weekly-qa.yml` runs Mondays 06:00 UTC (and on demand). It runs
the full pipeline against `extension@latest`, uploads `reports/` as an artifact,
and opens a `qa-regression` issue (body = `REPORT.md`) if anything regressed.

## Legacy

The top-level `chrome/`, `chromium/`, `mdn/`, `extension-create/` directories are
the **old 2023 vendored snapshot**. They're kept only until the automated fetch is
trusted, then should be removed; the `.cache/` clones supersede them entirely.

## License

MIT
