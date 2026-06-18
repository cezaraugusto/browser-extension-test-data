// Asset-integrity check: after a build that exits 0, assert every local file the
// EMITTED manifest references actually exists in dist/. Catches "builds green but
// drops declared assets" silent failures (e.g. the theme-image emission gap) that
// an exit-code-only verdict misses.
//
// We read the emitted manifest (dist/<browser>/manifest.json): Extension.js's own
// statement of what it produced: so a referenced-but-missing file is a real defect,
// not a source/output naming mismatch. Conservative by design: anything that isn't a
// concrete local path (URLs, data:, __MSG_ placeholders, wildcard globs) is skipped.
import fs from 'node:fs'
import path from 'node:path'

const SKIP = (p) =>
  typeof p !== 'string' ||
  p === '' ||
  /^[a-z][a-z0-9+.-]*:/i.test(p) || // scheme:// , data: , chrome-extension: , http(s):
  p.includes('__MSG_') || // i18n runtime placeholder
  /[*?]/.test(p) // wildcard/glob (e.g. web_accessible_resources "*.png")

function norm(p) {
  return p.replace(/^\.?\//, '').split(/[?#]/)[0]
}

// Pull every local file path a manifest references into a flat list.
function referencedPaths(m) {
  const out = []
  const add = (v) => {
    if (Array.isArray(v)) v.forEach(add)
    else if (v && typeof v === 'object') Object.values(v).forEach(add)
    else if (typeof v === 'string') out.push(v)
  }

  add(m.icons)
  for (const a of [m.action, m.browser_action, m.page_action]) {
    if (!a) continue
    add(a.default_icon)
    add(a.default_popup)
  }
  if (m.background) {
    add(m.background.service_worker)
    add(m.background.page)
    add(m.background.scripts)
  }
  for (const cs of m.content_scripts || []) {
    add(cs.js)
    add(cs.css)
  }
  // web_accessible_resources: MV2 = string[]; MV3 = {resources: string[]}[]
  if (Array.isArray(m.web_accessible_resources)) {
    for (const w of m.web_accessible_resources) {
      if (typeof w === 'string') add(w)
      else if (w && Array.isArray(w.resources)) add(w.resources)
    }
  }
  if (m.theme && m.theme.images) add(m.theme.images) // theme_frame, additional_backgrounds[]
  add(m.options_ui && m.options_ui.page)
  add(m.options_page)
  add(m.chrome_url_overrides) // newtab/history/bookmarks
  add(m.devtools_page)
  if (m.sidebar_action) {
    add(m.sidebar_action.default_panel)
    add(m.sidebar_action.default_icon)
  }
  add(m.side_panel && m.side_panel.default_path)
  add(m.sandbox && m.sandbox.pages)
  for (const r of (m.declarative_net_request && m.declarative_net_request.rule_resources) || []) {
    add(r.path)
  }

  return out
}

// Returns {ok, missing: string[], checked: number}. ok===true when distDir has no
// emitted manifest (nothing to assert) or every referenced file exists.
export function checkManifestAssets(distDir) {
  const manifestPath = path.join(distDir, 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return {ok: true, missing: [], checked: 0} // no manifest emitted → out of scope
  }
  const refs = [...new Set(referencedPaths(manifest).filter((p) => !SKIP(p)).map(norm))]
  const missing = refs.filter((rel) => !fs.existsSync(path.join(distDir, rel)))
  return {ok: missing.length === 0, missing, checked: refs.length}
}
