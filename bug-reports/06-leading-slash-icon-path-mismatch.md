# Bug 06 , leading-slash icon paths: manifest points to `images/`, files emitted to `icons/`

**CLI:** reproduced on `extension@3.18.4` **and `…canary.321.403955d`**
**Severity:** high , the packaged manifest references icon files that don't exist at that path; build is green
**Status:** reproducible, isolated, **open on the latest canary**

> Found by the testbed's asset-integrity check. Build exits 0, so exit-code-only scoring
> marks it PASS , but the emitted manifest's icon paths don't match where the icons were
> actually written. Distinct from the theme bug ([Bug 05](05-theme-images-not-emitted-to-dist.md));
> here the files *are* emitted, just under a different folder than the manifest claims.

## Repro

Self-contained copy:

```
/Users/cezaraugusto/local/extension-land/cezaraugusto/packages/browser-extension-test-data/bug-reports/repro/06-leading-slash-icon-path-mismatch
```

```sh
cd <a writable copy of that dir>
EXTENSION_SKIP_INSTALL=1 npx -y extension@canary build --browser chrome --silent
# build succeeds (exit 0), then:
node -e "console.log(require('./dist/chrome/manifest.json').icons['16'])"   # -> images/get_started16.png
test -f dist/chrome/images/get_started16.png && echo OK || echo "MISSING (file is in icons/ instead)"
```

Upstream: `GoogleChrome/chrome-extensions-samples` → `functional-samples/tutorial.getting-started`
(https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/tutorial.getting-started)

## Observed

The source manifest declares icons with **leading-slash absolute paths**:

```jsonc
"icons":  { "16": "/images/get_started16.png", "32": "/images/get_started32.png", … },
"action": { "default_icon": { "16": "/images/get_started16.png", … }, "default_popup": "popup.html" }
```

After build (exit 0):

- **Icon files are emitted** to `dist/chrome/icons/get_started16.png` … (Extension.js's
  standard `icons/` output folder).
- **The emitted manifest** references `images/get_started16.png` , it stripped the leading
  slash but kept `images/`, instead of updating to the real output path `icons/...`.

```
dist/chrome/manifest.json → icons["16"] = "images/get_started16.png"
dist/chrome/images/get_started16.png  → MISSING
dist/chrome/icons/get_started16.png   → present
```

The packaged extension's manifest points every icon (and `action.default_icon`) at a path
that doesn't exist in the bundle.

## Analysis

For ordinary relative icon paths (e.g. `icons/border-48.png`) the manifest rewrite and the
emission agree. The **leading slash** (`/images/...`) is the trigger: the path normaliser
strips `/` → `images/...` for the manifest, but the asset emitter relocates the files to
`icons/...`. The two sides disagree only for root-absolute paths.

## Suggested direction for the Extension.js maintainer

- Normalise leading-slash (`/path`) manifest asset references the same way for *both* the
  manifest rewrite and the file emission, so the emitted manifest path matches the emitted
  file location (whether icons land in `icons/` or keep their declared folder).
- Covers `icons`, `action.default_icon` (and `browser_action`/`page_action`); add a check
  that every emitted-manifest icon path resolves to an emitted file.

## Validation

`3.18.4` / `canary.321.403955d` → build green, manifest icon path unresolved
(integrity: `fail:missing-assets` for all four icon sizes).
