# Bug 01: build fails on bundled `browser-polyfill.min.js` (swc Syntax Error)

**CLI:** `extension@3.18.4`
**Severity:** medium: blocks any extension that vendors Mozilla's webextension-polyfill as a script
**Status:** ⚠️ FIXTURE INVALID + framework DX improved: re-validate on `extension@3.18.4-canary.320.767e107`

## Resolution (2026-06-18)

Two findings: the headline framing ("swc is too strict on the standard polyfill")
did **not** hold, but there was a real adjacent framework problem that is now fixed.

1. **The repro's polyfill is not valid JavaScript.**
   `repro/01-mocha-client-tests-addon/scripts/browser-polyfill.min.js` is an
   ~8 KB stub (the genuine Mozilla polyfill is ~50 KB). It contains
   `const wrapEvent=(wrapperMap)=>{addListener(...){...}}`, the genuine file is
   `=>({...})`. Object-method shorthand in an arrow **block** body is a syntax
   error, and **Node's own parser rejects it** too:

   ```sh
   node --check scripts/browser-polyfill.min.js
   # SyntaxError: Unexpected token '{'
   ```

   No bundler can parse genuinely invalid JS, so the build *correctly* fails.
   → **Action:** replace this fixture with the real, unmodified
   `browser-polyfill.min.js`. With a valid file the build succeeds on the canary.

2. **Framework DX bug (fixed): vendored `*.min.js` was being wrapped.**
   Extension.js applied the content-script reinjection wrapper to the vendored
   file (it lives in `scripts/`), prepending ~500 lines of mount/reload runtime
   and appending the `__EXTENSIONJS_REINJECT_GENERATION` epilogue to a
   third-party file. That shifted line numbers and produced the misleading
   "line 511 / line 514" diagnostic in the original report.
   → **Fix:** vendored `*.min.js` now passes through untouched (unless it is an
   explicitly declared `content_scripts` entry). The error now points honestly at
   the real file/line (`browser-polyfill.min.js:18:1`) with no injected epilogue.
   `programs/develop/plugin-web-extension/feature-scripts/steps/setup-reload-strategy/add-content-script-wrapper/content-script-wrapper.ts`
   (branch `fix/page-script-tla-and-vendored-minjs-passthrough`, commit `767e107`).

**Net:** not a parser-strictness bug. Swap in the genuine polyfill and re-run on
the canary; if it still fails, that's a new (real) report worth filing.

### ✅ Validated (2026-06-18)

Fixture replaced with genuine `webextension-polyfill@0.12.0` `dist/browser-polyfill.min.js`
(10 KB minified, `node --check` clean; the unminified source is 38 KB). On
`extension@3.18.4-canary.320.767e107` the repro now **builds clean, exit 0**. The
original 8 KB fixture is what upstream MDN commits and is itself invalid JS (a
separate upstream-MDN issue); the genuine file confirms the framework handles it.

## Repro

Self-contained copy (build it directly, no install needed):

```
/Users/cezaraugusto/local/extension-land/cezaraugusto/packages/browser-extension-test-data/bug-reports/repro/01-mocha-client-tests-addon
```

```sh
cd <a writable copy of that dir>
EXTENSION_SKIP_INSTALL=1 npx -y extension@3.18.4 build --browser chrome --silent
```

Upstream: `mdn/webextensions-examples` → `mocha-client-tests/addon`
(https://github.com/mdn/webextensions-examples/tree/main/mocha-client-tests/addon)

## Observed

Build fails. `swc-loader` throws a Syntax Error while processing
`scripts/browser-polyfill.min.js` (Mozilla's standard minified webextension-polyfill,
referenced by the sample):

```
ERROR in ./scripts/browser-polyfill.min.js
  × Module build failed (from builtin:swc-loader):
  ├─▶   ×   x Expected ';', '}' or <eof>
  │     │      ,-[…/scripts/browser-polyfill.min.js:511:1]
  │     │  511 | const wrapEvent=(wrapperMap)=>{addListener(target,listener,...args){…}, …};
  │     │      :                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  │     │  514 | try { __EXTENSIONJS_REINJECT_GENERATION = (Number(__EXTENSIONJS_REINJECT_GENERATION) || 0) + 1; } catch (error) {}
  │     │      `----
  ╰─▶   × Syntax Error
```

## Analysis

Two Extension.js-side signals in the error:

1. The parse error is reported at **line 511 of the original minified file**, and the
   trailing **line 514 is injected by Extension.js** (`__EXTENSIONJS_REINJECT_GENERATION`
   epilogue). The epilogue is being appended to a vendored library file that the
   sample only references as a plain `<script>` / content-script dependency.
2. `swc-loader` rejects the file. The file is the unmodified, widely-shipped
   `browser-polyfill.min.js`, so this is an Extension.js bundling-config problem, not
   malformed user code.

Likely cause: the reinjection-wrapper transform is applied to a vendored
`*.min.js` dependency it should pass through untouched, and/or the swc parser
config rejects the minified input that the wrapper then re-parses.

## Suggested direction for the Extension.js maintainer

- Skip the content-script reinjection wrapper (and re-parse) for vendored
  `*.min.js` files, or files not declared as first-party content-script entrypoints.
- Confirm whether appending the `__EXTENSIONJS_REINJECT_GENERATION` epilogue to an
  already-minified file is intended; if so, ensure it is appended as a separate
  module/statement rather than concatenated into the same parse unit.
