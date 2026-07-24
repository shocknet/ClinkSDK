import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { loadCurrentSdk, readCompatMeta, toHex } from './paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const relayUrl = process.env.RELAY_URL || 'ws://127.0.0.1:7777'
const receiptDelayMs = Number(process.env.RECEIPT_DELAY_MS || 2000)

describe('strfry request/response A↔B', () => {
  let serverPrivHex
  let serverPub
  let responder
  let readyDir
  let readyFile
  let sdk
  let generateSecretKey
  let getPublicKey

  before(async () => {
    readCompatMeta()
    sdk = await loadCurrentSdk()
    generateSecretKey = sdk.generateSecretKey
    getPublicKey = sdk.getPublicKey

    const serverPriv = generateSecretKey()
    serverPrivHex = toHex(serverPriv)
    serverPub = getPublicKey(serverPriv)

    readyDir = mkdtempSync(join(tmpdir(), 'clink-ready-'))
    readyFile = join(readyDir, 'ready')

    responder = spawn(process.execPath, [join(__dirname, 'relay-responder.mjs')], {
      env: {
        ...process.env,
        RELAY_URL: relayUrl,
        SERVER_NSEC_HEX: serverPrivHex,
        RECEIPT_DELAY_MS: String(receiptDelayMs),
        READY_FILE: readyFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    responder.stdout.on('data', (d) => process.stdout.write(`[responder] ${d}`))
    responder.stderr.on('data', (d) => process.stderr.write(`[responder] ${d}`))

    const readyProc = spawn(
      process.execPath,
      [join(__dirname, 'wait-for-ready.mjs')],
      {
        env: { ...process.env, READY_FILE: readyFile, READY_WAIT_MS: '30000' },
        stdio: 'inherit',
      }
    )
    const code = await new Promise((resolve) => readyProc.on('close', resolve))
    assert.equal(code, 0, 'responder did not reach EOSE in time')
  })

  after(() => {
    responder?.kill('SIGTERM')
    if (readyDir) rmSync(readyDir, { recursive: true, force: true })
  })

  it('noffer happy path returns dummy bolt11', async () => {
    const client = new sdk.ClinkSDK({
      privateKey: generateSecretKey(),
      relays: [relayUrl],
      toPubKey: serverPub,
      defaultTimeoutSeconds: 15,
    })
    const response = await client.Noffer({ offer: 'test_offer', amount_sats: 21 })
    assert.ok('bolt11' in response, `expected bolt11, got ${JSON.stringify(response)}`)
    assert.match(response.bolt11, /^lnbc1/)
  })

  it('ndebit happy path returns ok', async () => {
    const client = new sdk.ClinkSDK({
      privateKey: generateSecretKey(),
      relays: [relayUrl],
      toPubKey: serverPub,
      defaultTimeoutSeconds: 15,
    })
    const response = await client.Ndebit(
      sdk.newNdebitPaymentRequest('lnbc1clientinvoice', 100, 'ptr')
    )
    assert.equal(response.res, 'ok')
  })

  it('fast-reply race still resolves', async () => {
    const client = new sdk.ClinkSDK({
      privateKey: generateSecretKey(),
      relays: [relayUrl],
      toPubKey: serverPub,
      defaultTimeoutSeconds: 15,
    })
    const response = await client.Noffer({ offer: 'fast', amount_sats: 1 })
    assert.ok('bolt11' in response)
  })

  it('receipt callback fires on delayed synthetic receipt', async () => {
    const client = new sdk.ClinkSDK({
      privateKey: generateSecretKey(),
      relays: [relayUrl],
      toPubKey: serverPub,
      defaultTimeoutSeconds: 15,
    })

    let receipt = null
    const primary = await client.Noffer(
      { offer: 'with_receipt', amount_sats: 7 },
      (r) => {
        receipt = r
      }
    )
    assert.ok('bolt11' in primary)

    const deadline = Date.now() + receiptDelayMs + 10000
    while (!receipt && Date.now() < deadline) {
      await sleep(100)
    }
    assert.deepEqual(receipt, { res: 'ok' })
  })
})
