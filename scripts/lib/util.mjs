// Shared helpers for the QA testbed scripts.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn, spawnSync} from 'node:child_process'

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
export const CACHE_DIR = path.join(ROOT, '.cache')
export const REPORTS_DIR = path.join(ROOT, 'reports')

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback
    throw err
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

export function loadSources() {
  const {sources} = readJson(path.join(ROOT, 'sources.json'))
  return sources
}

export function enabledSources() {
  return loadSources().filter((s) => s.enabled)
}

// Promise pool: run `worker(item)` over `items` with bounded concurrency.
export async function pool(items, concurrency, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

// Run a command, capture stdout/stderr, never throw: return {ok, code, stdout, stderr, ms}.
export function exec(command, args, opts = {}) {
  const start = Date.now()
  const r = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    ...opts
  })
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    ms: Date.now() - start,
    error: r.error ? String(r.error) : null
  }
}

// Async variant with a hard timeout (build/dev can hang on a bad sample).
export function execAsync(command, args, opts = {}) {
  const {timeoutMs = 0, ...rest} = opts
  return new Promise((resolve) => {
    const start = Date.now()
    let out = ''
    let err = ''
    const child = spawn(command, args, {shell: false, ...rest})
    let timer = null
    let timedOut = false
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)
    }
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (err += d))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      resolve({ok: false, code: null, stdout: out, stderr: err, ms: Date.now() - start, error: String(e), timedOut})
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ok: code === 0 && !timedOut, code, stdout: out, stderr: err, ms: Date.now() - start, error: null, timedOut})
    })
  })
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, {recursive: true})
}

export {fs, path}
