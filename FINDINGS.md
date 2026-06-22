# QA Findings: first full run

**CLI:** `extension@3.18.4` · **Platform:** macOS · **Targets:** chrome, firefox, edge
**Corpus:** 221 samples (MDN 70 · Chrome 99 · Extension.js 52)

## Headline

**208 / 221 (94%) build cleanly** on all three browsers. Verdicts are identical
across chrome/firefox/edge: the 13 failures are source/config issues, not
browser-specific. This is the baseline the weekly job gates against.

> The committed baseline is **macOS-captured**. The gating CI lane runs on Linux
> (case-sensitive FS), so the first Linux run should be reviewed and re-baselined
> there: some `url()`/path failures below may differ.

### Update: canary re-validation (2026-06-18)

Re-ran the 13 failures on `extension@3.18.4-canary.320.767e107` (Extension.js fixes for
[bug 02](bug-reports/02-popup-top-level-await-not-treated-as-module.md) + vendored-min.js
passthrough). Corpus moves **208 → 210 / 221**: `tutorial.tabs-manager` and
`api-samples/sandbox` now build. Triage of the 11 still failing:

- **2 new framework bugs** (still open on canary) → fixing them recovers 2 more, reaching 212/221:
  [bug 03](bug-reports/03-theme-additional-backgrounds-array.md) (theme `additional_backgrounds`
  array crash) and [bug 04](bug-reports/04-chrome-extension-url-scheme-passthrough.md)
  (`chrome-extension://` URL not passed through in CSS).
- **1 corrupt-upstream** polyfill (`mocha-client-tests`: builds with the genuine file).
- **8 sample-side**: 4 reference pre-built `dist/` output (`store-collected-images`,
  `webpack-modules`, `ai.gemini-in-the-cloud`, `libraries-xhr-in-sw`); 4 missing
  source/asset files (`menu-demo`, `top-sites`, `fontSettings`, `sample.bookmarks`).

See `bug-reports/README.md` → "Open for the next canary" for the action list.

### Update: second canary `3.18.4-canary.321.403955d` (all 4 fixes)

Full 221 × {chrome,firefox,edge} corpus run, diffed against the `3.18.4` baseline:

- **212 / 221 pass · 0 regressions · 4 progressions.** The fixes introduced **no new
  errors**: notably the Bug 02 ESM change (now builds *every* page script as a module)
  broke nothing previously passing.
- Progressions are exactly the 4 filed bugs: `weta_mirror` (03), `sandbox` + `tabs-manager`
  (02), `custom-cursor` (04).
- The remaining **9 are all non-framework** (verified, no unknowns): 8 sample-side
  (4 pre-built `dist/` refs, 4 missing source/asset files) + 1 corrupt-upstream polyfill.

**Caveat: Bug 03 passes the build but the output is incomplete.** On this canary the
theme manifest references `theme/images/weta.png` + `weta-left.png` but the files are
**not emitted** to `dist/`. The crash is fixed; the array-image emission still needs
`browser-extension-manifest-fields@2.2.5` published + a dep bump + a fresh canary.

### Testbed blind spot to close (next)

The matrix scores on build exit code, so Bug 03 reads as PASS despite dropping declared
assets. Add an **asset-integrity check** to `run-matrix`: after a passing build, assert
every file referenced by the emitted `manifest.json` (icons, theme images, web-accessible
resources, HTML/script srcs) exists in `dist/`. Downgrade to `fail:missing-assets` otherwise.

## Failure taxonomy (13)

### A. Manifest references pre-built artifacts (5): *sample expects its own bundler*
These samples ship a manifest pointing at `dist/*.js`; Extension.js reads source
paths and the built files don't exist until the sample's own webpack runs.
- `mdn/store-collected-images/webextension-with-webpack/extension` → `dist/background.js`
- `mdn/webpack-modules/addon` → `popup/index.js`
- `chrome/functional-samples/ai.gemini-in-the-cloud` → `dist/sidepanel.bundle.js`
- `chrome/functional-samples/libraries-xhr-in-sw` → `dist/chrome/sidepanel/script.js`
- `mdn/menu-demo` → `sidebar/panel.css` (missing source)

*Likely legitimate skips, not Extension.js bugs. Candidate for a `known-fail` reason.*

### B. CSS `url()` asset resolution (3): *needs Extension.js triage*
Third-party CSS referencing images/fonts Extension.js can't resolve at build:
- `chrome/api-samples/fontSettings/fontSettings Advanced` → `../images/slider/*.png`
- `chrome/functional-samples/sample.bookmarks` → jquery-ui `images/ui-icons_*.png`
- `mdn/top-sites` → bootstrap glyphicon font faces

### C. Extension.js content-script wrapper breaks valid JS (2): *likely Extension.js bug*
The framework's reinjection wrapper (`__EXTENSIONJS_REINJECT_GENERATION` /
`feature-scripts-content-script-wrapper`) throws a Syntax Error on these inputs:
- `mdn/mocha-client-tests/addon`
- `chrome/functional-samples/tutorial.tabs-manager`

### D. Other (3)
- `mdn/themes/weta_mirror`: theme-only manifest; `buildCanonicalManifest` errors (no entrypoints).
- `chrome/functional-samples/tutorial.custom-cursor`: `chrome-extension:` URI scheme unhandled by plugins.
- `chrome/api-samples/sandbox/sandbox`: vendored CommonJS `require.main === module` in a bundled file.

## Recommended next actions
1. File B + C with Extension.js (real framework gaps; minimal repros available per sample).
2. Tag A as `known-fail: references-prebuilt-artifacts` so they don't read as regressions.
3. Re-baseline on the Linux CI runner; keep this macOS run as the local reference.
