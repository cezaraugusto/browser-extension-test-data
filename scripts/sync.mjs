#!/usr/bin/env node
// sync.mjs: fetch the latest commit of each enabled upstream, shallow-clone it
// into .cache/<id>, and report which sources changed since the last tested SHA.
//
// Writes sources.lock.json (the SHA actually under test). The weekly job uses
// the `changed` list to decide whether a full matrix re-run is warranted, but
// `--all` / cron always runs regardless so CLI regressions surface even when
// upstream is quiet.
import {ROOT, CACHE_DIR, enabledSources, exec, readJson, writeJson, ensureDir, fs, path} from './lib/util.mjs'

const LOCK = path.join(ROOT, 'sources.lock.json')

function remoteSha(repo, ref) {
  const r = exec('git', ['ls-remote', repo, ref])
  if (!r.ok) return null
  const line = r.stdout.split('\n').find(Boolean)
  return line ? line.split('\t')[0] : null
}

function clone(repo, ref, dest) {
  fs.rmSync(dest, {recursive: true, force: true})
  return exec('git', ['clone', '--depth', '1', '--branch', ref, repo, dest])
}

async function main() {
  ensureDir(CACHE_DIR)
  const lock = readJson(LOCK, {})
  const changed = []
  const summary = []

  for (const src of enabledSources()) {
    const dest = path.join(CACHE_DIR, src.id)
    const latest = remoteSha(src.repo, src.ref)
    if (!latest) {
      summary.push({id: src.id, status: 'unreachable'})
      console.error(`✗ ${src.id}: could not reach ${src.repo}`)
      continue
    }
    const prev = lock[src.id]?.sha
    const isChanged = prev !== latest
    if (isChanged || !fs.existsSync(path.join(dest, '.git'))) {
      const c = clone(src.repo, src.ref, dest)
      if (!c.ok) {
        summary.push({id: src.id, status: 'clone-failed'})
        console.error(`✗ ${src.id}: clone failed\n${c.stderr}`)
        continue
      }
      if (isChanged && prev) changed.push(src.id)
    }
    lock[src.id] = {sha: latest, ref: src.ref, repo: src.repo, fetchedAt: new Date().toISOString()}
    summary.push({id: src.id, status: isChanged ? (prev ? 'updated' : 'new') : 'unchanged', sha: latest.slice(0, 10)})
    console.log(`${isChanged ? '↻' : '✓'} ${src.id}: ${latest.slice(0, 10)} (${isChanged ? 'changed' : 'unchanged'})`)
  }

  writeJson(LOCK, lock)
  console.log(`\nChanged sources: ${changed.length ? changed.join(', ') : 'none'}`)
  // Emit for CI consumption (GitHub Actions step output).
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.join(',')}\n`)
  }
}

main()
