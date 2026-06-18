# Extension.js bug reports

Likely Extension.js framework bugs surfaced by the QA testbed (`extension@3.18.4`).
Each report is self-contained: a committed, pristine repro under `repro/`, the exact
build command, full error output, and root-cause analysis. Hand the absolute path of
a report to the Extension.js maintainer/AI.

## ✅ All four fixed , validate on `extension@3.18.4-canary.321.403955d`

Bugs 03 and 04 are now fixed too (branch `fix/page-script-tla-and-vendored-minjs-passthrough`,
commit `403955d`). The new canary `3.18.4-canary.321.403955d` carries all four fixes;
`extension@canary` also points at it.

- **Bug 03 , theme `additional_backgrounds` array crash → FIXED.** The theme manifest
  override mapped `path.basename()` over each entry instead of passing the array straight
  in. Repro now builds (exit 0). *Separate pre-existing note:* theme image **files** are
  not emitted to `dist/theme/images/` for any theme (single-string or array) , the
  manifest references them but the copy step is unwired. That's orthogonal to this crash
  and affects all themes equally; flag as its own follow-up if you want themes to render.
- **Bug 04 , `chrome-extension://` CSS URL passthrough → FIXED.** `chrome-extension:` and
  `moz-extension:` requests are externalized as `asset`, so the `url()` (and the
  `__MSG_@@extension_id__` placeholder) survive verbatim. Ordinary relative/`https:` URLs
  still resolve and emit normally.

Re-validate all four before/after with:

```sh
cp -R bug-reports/repro/<name> /tmp/<name> && cd /tmp/<name>
EXTENSION_SKIP_INSTALL=1 npx -y extension@3.18.4-canary.321.403955d build --browser chrome --silent
# …or track the channel
EXTENSION_SKIP_INSTALL=1 npx -y extension@canary build --browser chrome --silent
```

Keep filing in the same shape , the pristine-repro + exact-command + full-error + root-cause
format made all four fast to triage. Next round welcome.

## Status , triaged & fixed (2026-06-18)

Both reports were investigated against Extension.js source. Fixes are on branch
`fix/page-script-tla-and-vendored-minjs-passthrough` (commit `767e107`) and
published as a **canary** so you can validate end-to-end:

```sh
# pin the exact canary that contains the fixes
npx -y extension@3.18.4-canary.320.767e107 build --browser chrome --silent
# …or track the channel
npx -y extension@canary build --browser chrome --silent
```

| # | Report | Verdict | What to do next |
|---|--------|---------|-----------------|
| 01 | [content-script wrapper breaks minified polyfill](01-content-script-wrapper-breaks-minified-polyfill.md) | **Fixture was invalid JS** (upstream MDN ships a corrupt 8 KB polyfill; `node --check` rejects it). Framework improved: vendored `*.min.js` passes through untouched. | ✅ **Done** , swapped in genuine `webextension-polyfill@0.12.0` min.js; **builds clean on canary (exit 0)**. The corrupt file is an upstream-MDN defect, not a framework bug. |
| 02 | [popup top-level await not treated as module](02-popup-top-level-await-not-treated-as-module.md) | **Confirmed framework bug , FIXED.** Page/module scripts are now built as ES modules, so top-level await parses. | ✅ **Validated** , builds on canary (exit 0); same repro fails on `3.18.4` (exit 1). |
| 03 | [theme `additional_backgrounds` array crash](03-theme-additional-backgrounds-array.md) | **Confirmed framework bug , FIXED** on `…canary.321.403955d`. Override now maps `basename` over the array. | ✅ Builds on the new canary (exit 0); fails on `3.18.4` / `…canary.320` (exit 1). Note: theme image *files* still aren't emitted for any theme (separate pre-existing gap). |
| 04 | [`chrome-extension://` URL scheme passthrough](04-chrome-extension-url-scheme-passthrough.md) | **Confirmed framework bug , FIXED** on `…canary.321.403955d`. `chrome-extension:`/`moz-extension:` externalized as `asset`; URL + `__MSG_@@extension_id__` left verbatim. | ✅ Builds on the new canary (exit 0); fails on `3.18.4` / `…canary.320` (exit 1). |

### Canary corpus impact (validated 2026-06-18)

Re-ran all 13 prior failures (from the `3.18.4` baseline) on `extension@3.18.4-canary.320.767e107`:
the fixes recover **2 in-corpus** (`tutorial.tabs-manager` via Bug 02, and `api-samples/sandbox`
as a bonus from the same ESM treatment) → corpus moves **208 → 210 / 221**. Bug 01's
`mocha-client-tests` stays failing *in the corpus* only because upstream ships the corrupt
polyfill; with the genuine file it builds clean. Of the remaining 10, **6 are sample-side**
(reference pre-built `dist/` or missing source files), **3 are missing-asset** sample issues
(`sample.bookmarks`, `top-sites`, `fontSettings`), and **1 is Bug 03** above.

| # | Report | Repro (absolute) |
|---|--------|------------------|
| 01 | [content-script wrapper breaks minified polyfill](01-content-script-wrapper-breaks-minified-polyfill.md) | `…/bug-reports/repro/01-mocha-client-tests-addon` |
| 02 | [popup top-level await not treated as module](02-popup-top-level-await-not-treated-as-module.md) | `…/bug-reports/repro/02-tutorial-tabs-manager` |
| 03 | [theme additional_backgrounds array crash](03-theme-additional-backgrounds-array.md) | `…/bug-reports/repro/03-theme-additional-backgrounds-array` |
| 04 | [chrome-extension:// URL scheme passthrough](04-chrome-extension-url-scheme-passthrough.md) | `…/bug-reports/repro/04-chrome-extension-url-scheme-passthrough` |

Base path:
`/Users/cezaraugusto/local/extension-land/cezaraugusto/packages/browser-extension-test-data/bug-reports`

Reproduce any report:

```sh
cp -R bug-reports/repro/<name> /tmp/<name> && cd /tmp/<name>
EXTENSION_SKIP_INSTALL=1 npx -y extension@3.18.4 build --browser chrome --silent
```

(Build in a copy , Extension.js writes `dist/` next to the sources.)

These two are the `category C` items from [`../FINDINGS.md`](../FINDINGS.md); the
other 11 failures there are sample-side issues (pre-built `dist/` references, CSS
asset resolution) rather than framework bugs.
