# Bug 05 , theme images never emitted to `dist/` (build is green, output is broken)

**CLI:** reproduced on `extension@3.18.4`, `…canary.320.767e107`, **and `…canary.321.403955d`**
**Severity:** high , every theme produces a broken build; the manifest points at images that don't ship
**Status:** reproducible, isolated, **open on the latest canary**

> Found by the testbed's asset-integrity check (`scripts/lib/integrity.mjs`): the build
> exits 0, so an exit-code-only check scores it PASS , but the emitted `manifest.json`
> references `theme/images/*.png` files that were never written to `dist/`. This is the
> broader, still-open part of [Bug 03](03-theme-additional-backgrounds-array.md) (whose
> crash is fixed): it affects **single-string `theme_frame` too**, not just arrays.

## Repro

Self-contained copy (single-string `theme_frame` , the simplest case):

```
/Users/cezaraugusto/local/extension-land/cezaraugusto/packages/browser-extension-test-data/bug-reports/repro/05-theme-images-not-emitted
```

```sh
cd <a writable copy of that dir>
EXTENSION_SKIP_INSTALL=1 npx -y extension@canary build --browser chrome --silent
# build succeeds (exit 0), then:
test -f dist/chrome/theme/images/weta.png && echo EMITTED || echo MISSING   # -> MISSING
```

Upstream: `mdn/webextensions-examples` → `themes/weta_fade`
(https://github.com/mdn/webextensions-examples/tree/main/themes/weta_fade)

## Observed

```jsonc
// source manifest.json
"theme": { "images": { "theme_frame": "weta.png" } }   // weta.png IS present in the sample
```

Build exits 0. The **emitted** manifest rewrites the path:

```jsonc
// dist/chrome/manifest.json
"theme": { "images": { "theme_frame": "theme/images/weta.png" } }
```

…but `dist/chrome/` contains **only `manifest.json`** , `theme/images/weta.png` is never
written. The packaged theme references an image that doesn't exist.

## Scope , all 5 MDN themes affected

| sample | `theme.images` | 3.18.4 build | image emitted? |
|--------|----------------|--------------|----------------|
| `themes/animated` | `theme_frame: "parrot.png"` | green | ✗ |
| `themes/weta_fade` | `theme_frame: "weta.png"` | green | ✗ |
| `themes/weta_fade_chrome` | `theme_frame: "weta.png"` | green | ✗ |
| `themes/weta_tiled` | `additional_backgrounds: "weta_for_tiling.png"` (string) | green | ✗ |
| `themes/weta_mirror` | `additional_backgrounds: ["weta.png","weta-left.png"]` (array) | crash (Bug 03) | ✗ |

4 of the 5 built **green on `3.18.4`** while shipping a broken theme , the failure was
invisible to an exit-code check until the integrity assertion was added.

## Analysis

The theme manifest override rewrites `theme.images.*` paths to `theme/images/<file>`,
but no emit/copy step writes those source images into `dist/`. Applies to every
`theme.images` key , `theme_frame` and `additional_backgrounds` (string and array).

This matches the Bug 03 follow-up note (extension.js `f85c03f` +
`browser-extension-manifest-fields@2.2.5`), but empirically **single-string
`theme_frame` is still not emitted on `canary.321.403955d`** , so the emit fix either
doesn't cover `theme_frame` or isn't in this canary.

## Suggested direction for the Extension.js maintainer

- Wire a copy/emit step that writes every `theme.images.*` source file to
  `dist/theme/images/` , covering `theme_frame`, `theme_frame_inactive`,
  `additional_backgrounds` (string **and** array), and the `*_overlay`/`theme_ntp_*`
  keys , so the emitted file matches the rewritten manifest path.
- Re-run repro 05 (`theme_frame`), repro 03 (`additional_backgrounds` array), and
  `themes/weta_tiled` (`additional_backgrounds` string) , all three shapes must emit.

## Validation

`3.18.4` / `canary.320` / `canary.321` → build green, image **not** emitted (integrity: `fail:missing-assets`).
