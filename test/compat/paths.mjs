import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const defaultCompatRoot = join(repoRoot, 'test/fixtures/compat-trees')

export function getCompatRoot() {
  return resolve(process.env.COMPAT_ROOT || defaultCompatRoot)
}

/** Local hex helpers: compat trees must not depend on @noble/hashes subpaths. */
export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function readCompatMeta() {
  const metaPath = join(getCompatRoot(), 'meta.json')
  if (!existsSync(metaPath)) {
    throw new Error(`compat trees missing (${metaPath}); run node test/compat/setup-trees.mjs first`)
  }
  return JSON.parse(readFileSync(metaPath, 'utf8'))
}

export async function loadCurrentSdk() {
  const { currentTree } = readCompatMeta()
  return import(pathToFileURL(join(currentTree, 'build/index.js')).href)
}

/**
 * Emulate how 1.5.x apps use the SDK:
 * - ClinkSDK / SimplePool from @shocknet/clink-sdk
 * - nip44 / finalizeEvent from nested nostr-tools when SDK does not re-export them
 */
export async function loadPriorAppModules() {
  const { priorTree, priorVersion } = readCompatMeta()
  const sdkPkgJson = join(priorTree, 'node_modules/@shocknet/clink-sdk/package.json')
  const sdkMain = join(priorTree, 'node_modules/@shocknet/clink-sdk/build/index.js')
  if (!existsSync(sdkMain)) {
    throw new Error(`prior SDK build missing at ${sdkMain}`)
  }

  const sdk = await import(pathToFileURL(sdkMain).href)
  const requireFromSdk = createRequire(sdkPkgJson)

  let nip44
  let finalizeEvent
  let getPublicKey
  let generateSecretKey

  if (typeof sdk.nip44?.encrypt === 'function' && typeof sdk.finalizeEvent === 'function') {
    nip44 = sdk.nip44
    finalizeEvent = sdk.finalizeEvent
    getPublicKey = sdk.getPublicKey
    generateSecretKey = sdk.generateSecretKey
  } else {
    const tools = requireFromSdk('nostr-tools')
    nip44 = tools.nip44
    finalizeEvent = tools.finalizeEvent
    getPublicKey = tools.getPublicKey
    generateSecretKey = tools.generateSecretKey
  }

  return {
    priorVersion,
    sdk,
    SimplePool: sdk.SimplePool,
    nip44,
    finalizeEvent,
    getPublicKey,
    generateSecretKey,
  }
}
