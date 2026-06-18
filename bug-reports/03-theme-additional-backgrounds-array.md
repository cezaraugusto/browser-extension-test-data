# Bug 03 , theme build crashes on `additional_backgrounds` array (path.basename on Array)

**CLI:** reproduced on `extension@3.18.4` and `…canary.320.767e107`
**Severity:** medium , blocks any theme that declares more than one background image
**Status:** ✅ FIXED , validate on `extension@3.18.4-canary.321.403955d`

## Resolution (2026-06-18)

Confirmed and fixed.

- **Root cause:** `theme.images` values are usually a single path string
  (e.g. `theme_frame`), but `additional_backgrounds` is an **array** of paths.
  The theme manifest override passed the value straight to `path.basename()`
  (string-only) → `TypeError [ERR_INVALID_ARG_TYPE]`.
- **Fix:** `theme()` now maps the rewrite over arrays
  (`Array.isArray(value) ? value.map(rewrite) : rewrite(value)`); single-string
  paths keep working. `programs/develop/.../manifest-overrides/common/theme.ts`
  (branch `fix/page-script-tla-and-vendored-minjs-passthrough`, commit `403955d`).
- **Validate:** the committed repro builds clean (exit 0) on the canary above and
  the output manifest references `theme/images/weta.png` + `theme/images/weta-left.png`.

> **Separate pre-existing gap (not this crash):** theme image *files* are never
> copied to `dist/theme/images/` for *any* theme , single-string or array. The
> `theme` field group is computed by `browser-extension-manifest-fields` but no
> plugin consumes it into an emit/include list (and that package also skips array
> values). So the manifest points at images that aren't emitted. This affects all
> themes equally and is orthogonal to the crash; worth a dedicated report if you
> want themes to actually render.

## Repro

Self-contained copy (build it directly , no install needed):

```
/Users/cezaraugusto/local/extension-land/cezaraugusto/packages/browser-extension-test-data/bug-reports/repro/03-theme-additional-backgrounds-array
```

```sh
cd <a writable copy of that dir>
EXTENSION_SKIP_INSTALL=1 npx -y extension@3.18.4-canary.320.767e107 build --browser chrome --silent
```

Upstream: `mdn/webextensions-examples` → `themes/weta_mirror`
(https://github.com/mdn/webextensions-examples/tree/main/themes/weta_mirror)

## Observed

The manifest is a valid **theme** declaring two background images (both present in
the sample: `weta.png`, `weta-left.png`):

```json
"theme": {
  "images": { "additional_backgrounds": [ "weta.png", "weta-left.png" ] },
  "properties": { "additional_backgrounds_alignment": [ "right top", "left top" ] },
  "colors": { "frame": "#adb09f", "tab_text": "#000" }
}
```

Build fails:

```
ERROR Build failed.
  × caused by plugins in Compilation.hooks.processAssets
  ╰─▶   × TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received an instance of Array
        │     at Module.basename (node:path:1399:5)
        │     at theme_getBasename (…/extension-develop/dist/0~rspack-config.mjs:821:62)
        │     at …/0~rspack-config.mjs:829:53
        │     at Array.map (<anonymous>)
        │     at theme (…/0~rspack-config.mjs:827:82)
        │     at manifestCommon (…/0~rspack-config.mjs:902:12)
        │     at buildCanonicalManifest (…/0~rspack-config.mjs:1035:23)
```

## Analysis

`theme.images.additional_backgrounds` is, per the WebExtensions spec, an **array of
image paths** (a theme can layer multiple backgrounds). Extension.js's theme handler
passes that value straight to `path.basename()`, which only accepts a string , so it
throws on any theme with multiple backgrounds. The assets exist; this is purely a
type-handling bug in `theme_getBasename` / `theme()`.

Note the surrounding code already iterates (`Array.map` at `:829`), so the value is
expected to be array-shaped downstream , the `basename` call just isn't mapped over
the array.

## Suggested direction for the Extension.js maintainer

In `theme_getBasename` (`programs/develop/.../rspack-config`, around `0~rspack-config.mjs:821`):
normalize `additional_backgrounds` to an array and `path.basename()` each entry,
e.g. `(Array.isArray(v) ? v : [v]).map((p) => path.basename(p))`. A single-string
`theme_image` background still works; multi-image themes stop crashing.

## Validation

- `3.18.4` → fail · `3.18.4-canary.320.767e107` → fail (exit 1 from the committed repro).
- Single-background themes build fine , only the array form triggers it.
