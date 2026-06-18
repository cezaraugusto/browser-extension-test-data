// Resolve which Extension.js CLI the QA matrix runs against, and pin the exact
// version so a regression maps to a specific release.
//
// Priority (mirrors _FUTURE/examples/scripts/build-with-manifest.mjs):
//   1. EXTENSION_CLI_PATH: explicit path to a built cli.cjs (local dev)
//   2. EXTENSION_TAG / default: published `extension@<tag>` (default: latest)
//
// The weekly cron tests `latest` (what users get) but records the resolved
// semver (e.g. extension@3.18.4) in every report. Set EXTENSION_TAG=canary to
// gate the next release, or EXTENSION_CLI_PATH to test an unreleased local build.
import {fs, exec} from './util.mjs'

export function resolveCli() {
  const explicit = process.env.EXTENSION_CLI_PATH
  if (explicit && fs.existsSync(explicit)) {
    return {kind: 'local', tag: 'local', version: 'local', label: `local:${explicit}`, command: process.execPath, prefix: [explicit]}
  }
  const tag = process.env.EXTENSION_TAG || 'latest'
  // Resolve the concrete published version once, up front, for attribution.
  const r = exec('npm', ['view', `extension@${tag}`, 'version'])
  const version = r.ok ? r.stdout.trim().split('\n').pop() : tag
  const spec = `extension@${version !== tag ? version : tag}`
  return {kind: 'published', tag, version, label: spec, command: 'npx', prefix: ['-y', spec]}
}

// Build the argv for one `extension <mode>` invocation against a sample dir.
export function cliArgs(cli, mode, extra = []) {
  return [...cli.prefix, mode, ...extra]
}
