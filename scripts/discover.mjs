#!/usr/bin/env node
// discover.mjs: enumerate every extension sample in each cached source and
// classify it. Layout-aware (see sources.json `layout`):
//
//   manifest-root: a sample is any directory directly containing manifest.json.
//                    Stops descending once found (top-most manifest = root).
//                    MDN / Chrome / Edge / Opera style.
//
//   project-root: each immediate child of a scan dir is one sample, whose
//                    manifest may live beneath it (e.g. src/manifest.json).
//                    The sample ROOT is the child dir: Extension.js resolves the
//                    nested manifest and needs the root's extension.config.js,
//                    public/, package.json. Extension.js examples style.
//
// Building from the wrong root (e.g. src/ instead of the project dir) strips the
// loader config and produces phantom failures, so this distinction is load-bearing.
// Writes reports/samples.json: the work-list the matrix consumes.
import {ROOT, CACHE_DIR, enabledSources, readJson, writeJson, fs, path} from './lib/util.mjs'

const IGNORE_ALWAYS = new Set(['node_modules', 'dist', 'build', '.extension', '.git'])

function hasManifest(dir) {
  try {
    return fs.existsSync(path.join(dir, 'manifest.json'))
  } catch {
    return false
  }
}

// Recursively find the first manifest.json at or under `dir` (BFS, ignore noise).
function findManifest(dir, ignore) {
  const queue = [dir]
  while (queue.length) {
    const d = queue.shift()
    let entries
    try {
      entries = fs.readdirSync(d, {withFileTypes: true})
    } catch {
      continue
    }
    if (entries.some((e) => e.isFile() && e.name === 'manifest.json')) {
      return path.join(d, 'manifest.json')
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('.') || IGNORE_ALWAYS.has(e.name) || ignore.includes(e.name)) continue
      queue.push(path.join(d, e.name))
    }
  }
  return null
}

// manifest-root: collect every dir directly holding a manifest.json.
function walkManifestRoots(dir, ignore, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true})
  } catch {
    return
  }
  if (entries.some((e) => e.isFile() && e.name === 'manifest.json')) {
    out.push(dir)
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.') || IGNORE_ALWAYS.has(e.name) || ignore.includes(e.name)) continue
    walkManifestRoots(path.join(dir, e.name), ignore, out)
  }
}

// project-root: each immediate child of a scan dir is a sample root.
function listProjectRoots(scanDir, ignore, out) {
  let entries
  try {
    entries = fs.readdirSync(scanDir, {withFileTypes: true})
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.') || IGNORE_ALWAYS.has(e.name) || ignore.includes(e.name)) continue
    out.push(path.join(scanDir, e.name))
  }
}

function classify(sampleRoot, manifestPath) {
  if (!manifestPath) return {valid: false, reason: 'no-manifest'}
  let manifest
  try {
    manifest = readJson(manifestPath)
  } catch {
    return {valid: false, reason: 'unparseable-manifest'}
  }
  const entrypoints = []
  if (manifest.background) entrypoints.push('background')
  if (manifest.content_scripts) entrypoints.push('content_scripts')
  if (manifest.action || manifest.browser_action || manifest.page_action) entrypoints.push('action')
  if (manifest.options_ui || manifest.options_page) entrypoints.push('options')
  if (manifest.side_panel || manifest.sidebar_action) entrypoints.push('sidebar')
  if (manifest.devtools_page) entrypoints.push('devtools')
  if (manifest.chrome_url_overrides) entrypoints.push('overrides')
  const raw = JSON.stringify(manifest)
  // Extension.js supports vendor-prefixed keys (e.g. "chromium:manifest_version").
  // Fall back to those when the plain key is absent so classification is accurate.
  const prefixedMv = Object.keys(manifest)
    .filter((k) => /:manifest_version$/.test(k))
    .map((k) => manifest[k])
  const manifestVersion = manifest.manifest_version || Math.max(2, ...prefixedMv, 2)
  return {
    valid: true,
    name: manifest.name || path.basename(sampleRoot),
    manifestVersion,
    usesBrowserApi: /\bbrowser\./.test(raw) || Boolean(manifest.browser_specific_settings),
    hasBuildStep: fs.existsSync(path.join(sampleRoot, 'package.json')),
    entrypoints
  }
}

function main() {
  const samples = []
  for (const src of enabledSources()) {
    const base = path.join(CACHE_DIR, src.id)
    if (!fs.existsSync(base)) {
      console.error(`! ${src.id}: not cloned (run sync first): skipping`)
      continue
    }
    const ignore = src.ignore || []
    const layout = src.layout || 'manifest-root'
    const roots = []
    for (const scanRoot of src.scan) {
      const abs = path.join(base, scanRoot)
      if (layout === 'project-root') listProjectRoots(abs, ignore, roots)
      else walkManifestRoots(abs, ignore, roots)
    }
    let valid = 0
    for (const dir of roots) {
      const manifestPath =
        layout === 'project-root' ? findManifest(dir, ignore) : path.join(dir, 'manifest.json')
      const info = classify(dir, manifestPath)
      const rel = path.relative(base, dir)
      samples.push({
        source: src.id,
        id: `${src.id}/${rel}`,
        rel,
        path: dir,
        layout,
        // build tier: 'install' for samples needing deps/bundler, else 'raw'
        tier: info.hasBuildStep ? 'install' : 'raw',
        manifestRel: manifestPath ? path.relative(dir, manifestPath) : null,
        ...info
      })
      if (info.valid) valid++
    }
    console.log(`${src.id} [${layout}]: ${valid} samples (${roots.length - valid} invalid)`)
  }
  const valid = samples.filter((s) => s.valid)
  writeJson(path.join(ROOT, 'reports', 'samples.json'), {
    generatedAt: new Date().toISOString(),
    count: valid.length,
    samples
  })
  console.log(`\nTotal: ${valid.length} valid samples (${samples.length - valid.length} invalid)`)
}

main()
