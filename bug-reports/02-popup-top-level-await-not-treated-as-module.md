# Bug 02 , popup script with top-level `await` fails (not parsed as ES module)

**CLI:** `extension@3.18.4`
**Severity:** medium , blocks page scripts (popup/options/etc.) that use top-level await
**Status:** reproducible, isolated

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
