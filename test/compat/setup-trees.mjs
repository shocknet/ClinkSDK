#!/usr/bin/env node
/**
 * Materialize current + prior install trees for offline/relay compat tests.
 *
 * Env:
 *   PRIOR_SDK_VERSION — override prior package version (default: npm view latest)
 *   NOSTR_TOOLS_VERSION — optional candidate tools version for current tree
 *   COMPAT_ROOT — output directory (default: test/fixtures/compat-trees)
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const compatRoot = resolve(process.env.COMPAT_ROOT || join(repoRoot, 'test/fixtures/compat-trees'))
const currentTree = join(compatRoot, 'current')
const priorTree = join(compatRoot, 'prior')

function sh(cmd, args, opts = {}) {
  const inherit = opts.stdio === 'inherit'
  const result = execFileSync(cmd, args, {
    encoding: inherit ? undefined : 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
  if (inherit) return ''
  return String(result).trim()
}

function resolvePriorVersion() {
  if (process.env.PRIOR_SDK_VERSION) return process.env.PRIOR_SDK_VERSION
  return sh('npm', ['view', '@shocknet/clink-sdk', 'version'], { cwd: repoRoot })
}

function prepareCurrentTree() {
  rmSync(currentTree, { recursive: true, force: true })
  mkdirSync(currentTree, { recursive: true })

  // Isolated tree so candidate nostr-tools installs do not mutate the repo checkout.
  for (const name of ['package.json', 'package-lock.json', 'build', 'src', 'tsconfig.json']) {
    const src = join(repoRoot, name)
    if (!existsSync(src)) throw new Error(`missing ${name}; run npm run prepack first`)
    cpSync(src, join(currentTree, name), { recursive: true })
  }

  sh('npm', ['ci'], { cwd: currentTree, stdio: 'inherit' })

  const candidate = process.env.NOSTR_TOOLS_VERSION
  if (candidate) {
    console.log(`[setup-trees] installing nostr-tools@${candidate} into current tree`)
    sh('npm', ['install', '--no-save', `nostr-tools@${candidate}`], {
      cwd: currentTree,
      stdio: 'inherit',
    })
    // Candidate must typecheck/build (catches deep import breaks like lib/types/pool).
    console.log(`[setup-trees] prepack against nostr-tools@${candidate}`)
    sh('npm', ['run', 'prepack'], { cwd: currentTree, stdio: 'inherit' })
  }
}

function preparePriorTree(version) {
  rmSync(priorTree, { recursive: true, force: true })
  mkdirSync(priorTree, { recursive: true })
  writeFileSync(
    join(priorTree, 'package.json'),
    JSON.stringify(
      {
        name: 'clink-sdk-prior-tree',
        private: true,
        type: 'module',
        dependencies: {
          '@shocknet/clink-sdk': version,
        },
      },
      null,
      2
    )
  )
  console.log(`[setup-trees] installing @shocknet/clink-sdk@${version} into prior tree`)
  sh('npm', ['install'], { cwd: priorTree, stdio: 'inherit' })
}

const priorVersion = resolvePriorVersion()
console.log(`[setup-trees] prior SDK version: ${priorVersion}`)
prepareCurrentTree()
preparePriorTree(priorVersion)

writeFileSync(
  join(compatRoot, 'meta.json'),
  JSON.stringify(
    {
      priorVersion,
      nostrToolsVersion: process.env.NOSTR_TOOLS_VERSION || null,
      currentTree,
      priorTree,
      createdAt: new Date().toISOString(),
    },
    null,
    2
  )
)

console.log(`[setup-trees] ready under ${compatRoot}`)
