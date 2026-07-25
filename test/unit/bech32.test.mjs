import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  decodeBech32,
  nofferEncode,
  ndebitEncode,
  nmanageEncode,
  OfferPriceType,
} from '../../build/index.js'

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/bech32.json'), 'utf8')
)

describe('bech32 round-trip', () => {
  it('decodes and re-encodes noffer fixture', () => {
    const { encoded, decoded } = fixtures.noffer
    const result = decodeBech32(encoded)
    assert.equal(result.type, 'noffer')
    assert.equal(result.data.pubkey, decoded.pubkey)
    assert.equal(result.data.relay, decoded.relay)
    assert.equal(result.data.offer, decoded.offer)
    assert.equal(result.data.priceType, decoded.priceType)
    assert.equal(result.data.price, decoded.price)

    const reencoded = nofferEncode({
      ...decoded,
      priceType: OfferPriceType.Fixed,
    })
    assert.equal(reencoded, encoded)
  })

  it('decodes and re-encodes ndebit fixture', () => {
    const { encoded, decoded } = fixtures.ndebit
    const result = decodeBech32(encoded)
    assert.equal(result.type, 'ndebit')
    assert.equal(result.data.pubkey, decoded.pubkey)
    assert.equal(result.data.relay, decoded.relay)
    assert.equal(result.data.pointer, decoded.pointer)
    assert.equal(result.data.k1, undefined)
    assert.equal(ndebitEncode(decoded), encoded)
  })

  it('round-trips ndebit with session k1 (TLV 3)', () => {
    const { encoded, decoded } = fixtures.ndebit_with_k1
    assert.equal(ndebitEncode(decoded), encoded)
    const result = decodeBech32(encoded)
    assert.equal(result.type, 'ndebit')
    assert.equal(result.data.pubkey, decoded.pubkey)
    assert.equal(result.data.relay, decoded.relay)
    assert.equal(result.data.pointer, decoded.pointer)
    assert.equal(result.data.k1, decoded.k1)
    assert.equal(ndebitEncode(result.data), encoded)
  })

  it('round-trips nmanage encode/decode', () => {
    const { decoded } = fixtures.nmanage
    const encoded = nmanageEncode(decoded)
    const result = decodeBech32(encoded)
    assert.equal(result.type, 'nmanage')
    assert.equal(result.data.pubkey, decoded.pubkey)
    assert.equal(result.data.relay, decoded.relay)
    assert.equal(result.data.pointer, decoded.pointer)
  })
})
