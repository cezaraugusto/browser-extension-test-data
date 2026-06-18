# Bug 02 , popup script with top-level `await` fails (not parsed as ES module)

**CLI:** `extension@3.18.4`
**Severity:** medium , blocks page scripts (popup/options/etc.) that use top-level await
**Status:** ✅ FIXED , validate on `extension@3.18.4-canary.320.767e107` (npm tag `canary`)

## Resolution (2026-06-18)

Confirmed as a genuine framework bug and fixed.

- **Root cause:** `popup.html` loads `popup.js` via `<script type="module">`, so it
  is a legitimate ES module and top-level await is legal. But Rspack classifies
  any first-party script *without* `import`/`export` as a non-module and rejects
  top-level await , even though swc already parses these files with
  `isModule: true`. The two layers disagreed on the module type.
- **Fix:** the non-content-script swc rule is now marked
  `type: "javascript/esm"`, so Rspack treats page/background scripts as ES
  modules (matching swc). Content-script rules are deliberately left untouched ,
  they are injected as classic scripts and must stay non-ESM.
- **Where:** `programs/develop/plugin-js-frameworks/index.ts` (branch
  `fix/page-script-tla-and-vendored-minjs-passthrough`, commit `767e107`).
  Output preserves `<script type="module">` and Rspack's async-module runtime
  wraps the top-level await correctly.
- **Validate:** the committed repro builds clean on the canary above.

This report's format (pristine repro + exact command + full error + root-cause)
was ideal , please keep filing in exactly this shape.

## Repro

Self-contained copy (build it directly , no install needed):

```
/Users/cezaraugusto/local/extension-land/cezaraugusto/packages/browser-extension-test-data/bug-reports/repro/02-tutorial-tabs-manager
```

```sh
cd <a writable copy of that dir>
EXTENSION_SKIP_INSTALL=1 npx -y extension@3.18.4 build --browser chrome --silent
```

Upstream: `GoogleChrome/chrome-extensions-samples` → `functional-samples/tutorial.tabs-manager`
(https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/tutorial.tabs-manager)

## Observed

Build fails. `popup.js` opens with top-level `await`:

```js
// popup.js
const tabs = await chrome.tabs.query({ url: [ 'https://developer.chrome.com/docs/webstore/*', … ] });
```

```
ERROR in ./popup.js
  × Module parse failed:
  ╰─▶   × JavaScript parse error: Top-level-await is only supported in ECMAScript Modules
          ╭─[14:13]
       14 │ const tabs = await chrome.tabs.query({
          ·              ─────
  help:
        File was processed with these loaders:
         * builtin:swc-loader??ruleSet[1].rules[2].use[0]
         * …/extension-develop/dist/feature-scripts-content-script-wrapper.js??ruleSet[1].rules[8].use[0]
        You may need an additional loader to handle the result of these loaders.
```

## Analysis

- `popup.js` is the **popup page script** (loaded by `popup.html` via `<script>`),
  not a content script. It is valid: top-level await is legal in an ES module, and
  page scripts in MV3 are loaded as modules.
- The error's loader chain shows Extension.js applied
  **`feature-scripts-content-script-wrapper.js`** (ruleSet rules[8]) to `popup.js`,
  and the output is parsed as a **non-module script**, where top-level await is
  illegal. So the failure is purely a build-time treatment problem.

Likely cause: the content-script wrapper rule matches a popup/page entry it
shouldn't, and/or the module type for page scripts isn't set to `module`, so swc
parses with script semantics and rejects top-level await.

## Suggested direction for the Extension.js maintainer

- Scope the `feature-scripts-content-script-wrapper` loader to actual
  `content_scripts` entrypoints only; exclude HTML page scripts (popup, options,
  sidebar, newtab, devtools).
- Ensure page/popup scripts are emitted/parsed as ES modules so top-level await is
  supported (Chrome and Firefox both allow `type="module"` page scripts).
