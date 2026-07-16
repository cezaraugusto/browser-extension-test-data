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
//
// Modes:
//   default      scan the .cache/ upstream clones (what the weekly QA run tests).
//   --vendored   scan the tracked corpus dirs instead (see vendor.mjs). Sample ids
//                are identical in both modes (source id + upstream-relative path),
//                so baseline.json and skips.json apply unchanged. Vendored mode
//                additionally writes catalog.json at the repo root: the committed,
//                machine-readable index of EVERY vendored sample, including
//                catalog-only trees the matrix never builds (chrome/_archive,
//                the frozen chromium corpus). Downstream consumers read the
//                catalog instead of re-implementing this discovery, which matters
//                because project-root samples keep their manifest under src/ and
//                naive manifest-dir walkers would pick the wrong root.
import {ROOT, CACHE_DIR, loadSources, enabledSources, readJson, writeJson, fs, path} from './lib/util.mjs'

const VENDORED = process.argv.includes('--vendored')

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

// Enumerate + classify every sample for one source under `base` across `scanDirs`.
// Ids are `srcId/<path relative to base>`; because vendored dirs preserve the
// upstream-relative layout, ids are identical whether base is .cache/<id> or the
// tracked vendorDir (baseline/skips compatibility depends on this).
function discoverSource(src, base, scanDirs) {
  const ignore = src.ignore || []
  const layout = src.layout || 'manifest-root'
  const roots = []
  for (const scanRoot of scanDirs) {
    const abs = scanRoot === '.' ? base : path.join(base, scanRoot)
    if (layout === 'project-root') listProjectRoots(abs, ignore, roots)
    else walkManifestRoots(abs, ignore, roots)
  }
  return roots.map((dir) => {
    const manifestPath =
      layout === 'project-root' ? findManifest(dir, ignore) : path.join(dir, 'manifest.json')
    const info = classify(dir, manifestPath)
    const rel = path.relative(base, dir)
    return {
      source: src.id,
      id: `${src.id}/${rel}`,
      rel,
      path: dir,
      layout,
      // build tier: 'install' for samples needing deps/bundler, else 'raw'
      tier: info.hasBuildStep ? 'install' : 'raw',
      manifestRel: manifestPath ? path.relative(dir, manifestPath) : null,
      ...info
    }
  })
}

// Repo-relative posix view of a sample: what catalog.json publishes to consumers.
function catalogEntry(sample, matrix) {
  const dir = path.relative(ROOT, sample.path).split(path.sep).join('/')
  return {
    id: sample.id,
    source: sample.source,
    dir,
    layout: sample.layout,
    matrix,
    tier: sample.tier,
    valid: sample.valid,
    ...(sample.reason ? {reason: sample.reason} : {}),
    ...(sample.valid
      ? {
          name: sample.name,
          manifest: sample.manifestRel ? `${dir}/${sample.manifestRel.split(path.sep).join('/')}` : null,
          manifestVersion: sample.manifestVersion,
          usesBrowserApi: sample.usesBrowserApi,
          hasBuildStep: sample.hasBuildStep,
          entrypoints: sample.entrypoints
        }
      : {})
  }
}

function main() {
  const samples = [] // matrix work list (enabled sources, scan trees only)
  const catalog = [] // vendored mode: the full committed data-product index
  const catalogSources = {}

  for (const src of VENDORED ? loadSources() : enabledSources()) {
    if (VENDORED) {
      if (!src.vendorDir) {
        if (src.enabled) console.error(`! ${src.id}: enabled but has no vendorDir: absent from vendored run`)
        continue
      }
      const base = path.join(ROOT, src.vendorDir)
      if (!fs.existsSync(base)) {
        console.error(`! ${src.id}: ${src.vendorDir}/ missing (run vendor.mjs first): skipping`)
        continue
      }
      const stamp = readJson(path.join(base, 'VENDORED.json'), null)
      if (!stamp) console.error(`! ${src.id}: ${src.vendorDir}/ has no VENDORED.json provenance`)
      // Matrix work only comes from enabled sources' scan trees. Everything else
      // vendored (vendorInclude extras, frozen corpora via vendorScan) is
      // catalog-only: real data for consumers, never built by the harness.
      const matrixScan = src.enabled ? src.scan : []
      const extraScan = src.enabled ? src.vendorInclude || [] : src.vendorScan || src.scan
      const matrixSamples = discoverSource(src, base, matrixScan)
      const extraSamples = discoverSource(src, base, extraScan)
      samples.push(...matrixSamples)
      catalog.push(
        ...matrixSamples.map((s) => catalogEntry(s, true)),
        ...extraSamples.map((s) => catalogEntry(s, false))
      )
      catalogSources[src.id] = {
        vendorDir: src.vendorDir,
        ...(stamp?.frozen ? {frozen: true} : {sha: stamp?.sha || null, ref: stamp?.ref || null}),
        repo: src.repo,
        matrixSamples: matrixSamples.length,
        catalogOnlySamples: extraSamples.length
      }
      const valid = [...matrixSamples, ...extraSamples].filter((s) => s.valid).length
      console.log(
        `${src.id} [${src.layout || 'manifest-root'}] (vendored): ${matrixSamples.length} matrix + ${extraSamples.length} catalog-only (${valid} valid)`
      )
    } else {
      const base = path.join(CACHE_DIR, src.id)
      if (!fs.existsSync(base)) {
        console.error(`! ${src.id}: not cloned (run sync first): skipping`)
        continue
      }
      const found = discoverSource(src, base, src.scan)
      samples.push(...found)
      const valid = found.filter((s) => s.valid).length
      console.log(`${src.id} [${src.layout || 'manifest-root'}]: ${valid} samples (${found.length - valid} invalid)`)
    }
  }

  const valid = samples.filter((s) => s.valid)
  writeJson(path.join(ROOT, 'reports', 'samples.json'), {
    generatedAt: new Date().toISOString(),
    mode: VENDORED ? 'vendored' : 'upstream-cache',
    count: valid.length,
    samples
  })
  console.log(`\nTotal: ${valid.length} valid samples (${samples.length - valid.length} invalid)`)

  if (VENDORED) {
    catalog.sort((a, b) => a.id.localeCompare(b.id))
    writeJson(path.join(ROOT, 'catalog.json'), {
      $comment:
        'Committed index of every vendored sample in this repo. Consume this instead of walking for manifest.json: project-root samples keep their manifest under src/ and the sample root (this `dir`) is the only correct build root. `matrix: false` marks catalog-only data the QA matrix never builds (archived or intentionally-broken samples included on purpose).',
      generatedAt: new Date().toISOString(),
      sources: catalogSources,
      count: catalog.length,
      samples: catalog
    })
    console.log(`Catalog: ${catalog.length} samples -> catalog.json`)
  }
}

main()
