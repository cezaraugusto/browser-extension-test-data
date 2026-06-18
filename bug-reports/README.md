# Extension.js bug reports

Likely Extension.js framework bugs surfaced by the QA testbed (`extension@3.18.4`).
Each report is self-contained: a committed, pristine repro under `repro/`, the exact
build command, full error output, and root-cause analysis. Hand the absolute path of
a report to the Extension.js maintainer/AI.

| # | Report | Repro (absolute) |
|---|--------|------------------|
| 01 | [content-script wrapper breaks minified polyfill](01-content-script-wrapper-breaks-minified-polyfill.md) | `…/bug-reports/repro/01-mocha-client-tests-addon` |
| 02 | [popup top-level await not treated as module](02-popup-top-level-await-not-treated-as-module.md) | `…/bug-reports/repro/02-tutorial-tabs-manager` |

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
