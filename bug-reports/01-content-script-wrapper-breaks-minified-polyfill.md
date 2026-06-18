# Bug 01 , build fails on bundled `browser-polyfill.min.js` (swc Syntax Error)

**CLI:** `extension@3.18.4`
**Severity:** medium , blocks any extension that vendors Mozilla's webextension-polyfill as a script
**Status:** reproducible, isolated

## Repro

Self-contained copy (build it directly , no install needed):

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
