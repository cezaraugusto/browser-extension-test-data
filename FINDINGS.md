# QA Findings , first full run

**CLI:** `extension@3.18.4` · **Platform:** macOS · **Targets:** chrome, firefox, edge
**Corpus:** 221 samples (MDN 70 · Chrome 99 · Extension.js 52)

## Headline

**208 / 221 (94%) build cleanly** on all three browsers. Verdicts are identical
across chrome/firefox/edge , the 13 failures are source/config issues, not
browser-specific. This is the baseline the weekly job gates against.

> The committed baseline is **macOS-captured**. The gating CI lane runs on Linux
> (case-sensitive FS), so the first Linux run should be reviewed and re-baselined
> there , some `url()`/path failures below may differ.

## Failure taxonomy (13)

### A. Manifest references pre-built artifacts (5) , *sample expects its own bundler*
These samples ship a manifest pointing at `dist/*.js`; Extension.js reads source
paths and the built files don't exist until the sample's own webpack runs.
- `mdn/store-collected-images/webextension-with-webpack/extension` → `dist/background.js`
- `mdn/webpack-modules/addon` → `popup/index.js`
- `chrome/functional-samples/ai.gemini-in-the-cloud` → `dist/sidepanel.bundle.js`
- `chrome/functional-samples/libraries-xhr-in-sw` → `dist/chrome/sidepanel/script.js`
- `mdn/menu-demo` → `sidebar/panel.css` (missing source)

*Likely legitimate skips, not Extension.js bugs. Candidate for a `known-fail` reason.*

### B. CSS `url()` asset resolution (3) , *needs Extension.js triage*
Third-party CSS referencing images/fonts Extension.js can't resolve at build:
- `chrome/api-samples/fontSettings/fontSettings Advanced` → `../images/slider/*.png`
- `chrome/functional-samples/sample.bookmarks` → jquery-ui `images/ui-icons_*.png`
- `mdn/top-sites` → bootstrap glyphicon font faces

### C. Extension.js content-script wrapper breaks valid JS (2) , *likely Extension.js bug*
The framework's reinjection wrapper (`__EXTENSIONJS_REINJECT_GENERATION` /
`feature-scripts-content-script-wrapper`) throws a Syntax Error on these inputs:
- `mdn/mocha-client-tests/addon`
- `chrome/functional-samples/tutorial.tabs-manager`

### D. Other (3)
- `mdn/themes/weta_mirror` , theme-only manifest; `buildCanonicalManifest` errors (no entrypoints).
- `chrome/functional-samples/tutorial.custom-cursor` , `chrome-extension:` URI scheme unhandled by plugins.
- `chrome/api-samples/sandbox/sandbox` , vendored CommonJS `require.main === module` in a bundled file.

## Recommended next actions
1. File B + C with Extension.js (real framework gaps; minimal repros available per sample).
2. Tag A as `known-fail: references-prebuilt-artifacts` so they don't read as regressions.
3. Re-baseline on the Linux CI runner; keep this macOS run as the local reference.
