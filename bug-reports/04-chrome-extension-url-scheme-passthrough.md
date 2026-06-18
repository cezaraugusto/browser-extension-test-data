# Bug 04 , `chrome-extension://` URLs in CSS fail build (should pass through)

**CLI:** reproduced on `extension@3.18.4` **and** `extension@3.18.4-canary.320.767e107`
**Severity:** medium , blocks extensions that self-reference assets via `chrome-extension://__MSG_@@extension_id__/…`
**Status:** reproducible, isolated, **not fixed on canary**

## Repro

Self-contained copy (build it directly , no install needed):

```
/Users/cezaraugusto/local/extension-land/cezaraugusto/packages/browser-extension-test-data/bug-reports/repro/04-chrome-extension-url-scheme-passthrough
```

```sh
cd <a writable copy of that dir>
EXTENSION_SKIP_INSTALL=1 npx -y extension@3.18.4-canary.320.767e107 build --browser chrome --silent
```

Upstream: `GoogleChrome/chrome-extensions-samples` → `functional-samples/tutorial.custom-cursor`
(https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/tutorial.custom-cursor)

## Observed

`style.css` sets a custom cursor that self-references the extension's own images via
the runtime `chrome-extension://__MSG_@@extension_id__/` URL (both images , `dino.png`,
`dino-pointer.png` , are present in the sample):

```css
cursor:
  url('chrome-extension://__MSG_@@extension_id__/dino.png') 16 16,
  auto;
```

Build fails:

```
ERROR in chrome-extension://__MSG_@@extension_id__/dino.png
  × Module build failed:
  ╰─▶   × Reading from "chrome-extension://__MSG_@@extension_id__/dino.png" is not handled by plugins (Unhandled scheme).
        │ Extension.js supports "data:" and "file:" URIs by default.
        │ You may need an additional plugin to handle "chrome-extension:" URIs.
```

## Analysis

`chrome-extension://__MSG_@@extension_id__/<path>` is a **valid runtime self-reference**:
in the loaded extension it resolves to the extension's own origin, and
`__MSG_@@extension_id__` is the standard i18n placeholder for the live extension ID.
It is **not** a build-time module to resolve.

Extension.js routes the `url()` through the bundler's module resolver, which rejects
the `chrome-extension:` scheme. The asset exists; the URL is correct. The bundler
should treat `chrome-extension://` URLs as **external / passthrough** (leave the
string verbatim in the emitted CSS) the same way a browser does at runtime.

## Suggested direction for the Extension.js maintainer

- Add `chrome-extension:` (and `moz-extension:`) to the set of schemes left
  untouched by the CSS/asset loader , pass the `url()` through verbatim rather than
  attempting to read it as a module (alongside the existing `data:`/`file:` handling).
- Preserve the `__MSG_@@extension_id__` placeholder unmodified so runtime i18n
  substitution still resolves it to the live extension ID.

## Validation

`3.18.4` → fail · `3.18.4-canary.320.767e107` → fail (exit 1 from the committed repro).
