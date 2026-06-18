# Extension.js bug reports

Likely Extension.js framework bugs surfaced by the QA testbed (`extension@3.18.4`).
Each report is self-contained: a committed, pristine repro under `repro/`, the exact
build command, full error output, and root-cause analysis. Hand the absolute path of
a report to the Extension.js maintainer/AI.

## ▶ Open for the next canary (action list)

Two confirmed framework bugs are still open on `extension@3.18.4-canary.320.767e107`.
Both have a committed, pristine repro that fails with exit 1. Fixing these should
recover 2 more corpus samples (`themes/weta_mirror`, `tutorial.custom-cursor`),
moving the corpus from 210 → 212 / 221.

1. **Bug 03 , theme `additional_backgrounds` array crash**
   ([report](03-theme-additional-backgrounds-array.md) · repro `repro/03-theme-additional-backgrounds-array`)
   `theme_getBasename` calls `path.basename()` on `theme.images.additional_backgrounds`,
   which is an array → `TypeError [ERR_INVALID_ARG_TYPE]`. Source pointer:
   `…/extension-develop/dist/0~rspack-config.mjs:821` (`theme_getBasename`).
   **Fix:** map `basename` over the array , `(Array.isArray(v) ? v : [v]).map(p => path.basename(p))`.

2. **Bug 04 , `chrome-extension://` URL scheme not passed through**
   ([report](04-chrome-extension-url-scheme-passthrough.md) · repro `repro/04-chrome-extension-url-scheme-passthrough`)
   `url('chrome-extension://__MSG_@@extension_id__/dino.png')` in CSS is sent to the
   module resolver → "Unhandled scheme". It is a runtime self-reference, not a build
   input. **Fix:** treat `chrome-extension:` / `moz-extension:` as passthrough schemes
   (like `data:`/`file:`); leave the `url()` and the `__MSG_@@extension_id__` placeholder verbatim.

Verify each before/after with:

```sh
cp -R bug-reports/repro/<name> /tmp/<name> && cd /tmp/<name>
EXTENSION_SKIP_INSTALL=1 npx -y extension@canary build --browser chrome --silent
```

Already fixed on this canary (no action): Bug 01 (vendored `*.min.js` passthrough) and
Bug 02 (page scripts built as ES modules). Re-validate they still pass after the new fixes.

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
| 03 | [theme `additional_backgrounds` array crash](03-theme-additional-backgrounds-array.md) | **New framework bug , NOT fixed on canary.** `path.basename()` called on the `additional_backgrounds` **array** → `ERR_INVALID_ARG_TYPE`. Blocks multi-background themes. | Map `basename` over the array in `theme_getBasename`. Repro fails on both `3.18.4` and canary (exit 1). |

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
