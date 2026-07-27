import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadCurrentSdk, loadPriorAppModules, readCompatMeta, toHex } from './paths.mjs'

describe('tools API surface + self nip44', () => {
  before(() => {
    readCompatMeta()
  })

  it('exposes helpers and pool methods used by sender', async () => {
    const sdk = await loadCurrentSdk()
    assert.equal(typeof sdk.finalizeEvent, 'function')
    assert.equal(typeof sdk.getPublicKey, 'function')
    assert.equal(typeof sdk.SimplePool, 'function')
    assert.equal(typeof sdk.nip44?.encrypt, 'function')
    assert.equal(typeof sdk.nip44?.decrypt, 'function')
    assert.equal(typeof sdk.nip44?.getConversationKey, 'function')
    assert.equal(typeof sdk.verifyEvent, 'function')

    const pool = new sdk.SimplePool()
    assert.equal(typeof pool.subscribeMany, 'function')
    assert.equal(typeof pool.publish, 'function')
    pool.destroy?.()
  })

  it('round-trips a CLINK-shaped payload with SDK nip44', async () => {
    const { nip44, generateSecretKey, getPublicKey } = await loadCurrentSdk()
    const priv = generateSecretKey()
    const peer = getPublicKey(generateSecretKey())
    const payload = { offer: 'x', amount_sats: 21, description: 'compat' }
    const ck = nip44.getConversationKey(priv, peer)
    const cipher = nip44.encrypt(JSON.stringify(payload), ck)
    const plain = JSON.parse(nip44.decrypt(cipher, ck))
    assert.deepEqual(plain, payload)
  })

  it('keeps nostr-tools/lib/types/pool.d.ts available for deep type imports', () => {
    const meta = readCompatMeta()
    const poolDts = join(meta.currentTree, 'node_modules/nostr-tools/lib/types/pool.d.ts')
    assert.equal(existsSync(poolDts), true, `missing ${poolDts}`)
  })
})

describe('offline cross-decrypt current ↔ prior', () => {
  it('A encrypt → B decrypt and reverse', async () => {
    const current = await loadCurrentSdk()
    const prior = await loadPriorAppModules()

    const aPriv = current.generateSecretKey()
    const bPriv = prior.generateSecretKey()
    const aPub = current.getPublicKey(aPriv)
    const bPub = prior.getPublicKey(bPriv)

    const request = { offer: 'coffee', amount_sats: 1000 }
    const aCipher = current.nip44.encrypt(
      JSON.stringify(request),
      current.nip44.getConversationKey(aPriv, bPub)
    )
    const aPlain = JSON.parse(
      prior.nip44.decrypt(aCipher, prior.nip44.getConversationKey(bPriv, aPub))
    )
    assert.deepEqual(aPlain, request)

    const reply = { bolt11: 'lnbc1dummyinvoice' }
    const bCipher = prior.nip44.encrypt(
      JSON.stringify(reply),
      prior.nip44.getConversationKey(bPriv, aPub)
    )
    const bPlain = JSON.parse(
      current.nip44.decrypt(bCipher, current.nip44.getConversationKey(aPriv, bPub))
    )
    assert.deepEqual(bPlain, reply)

    assert.equal(
      toHex(current.nip44.getConversationKey(aPriv, bPub)),
      toHex(prior.nip44.getConversationKey(bPriv, aPub))
    )
  })
})
