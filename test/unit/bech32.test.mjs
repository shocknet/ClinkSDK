import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { concatBytes, hexToBytes } from '@noble/hashes/utils'
import { bech32 } from '@scure/base'
import {
  decodeBech32,
  nofferEncode,
  ndebitEncode,
  nmanageEncode,
  OfferPriceType,
  isNofferReceipt,
  nip19,
  ClinkSDK,
} from '../../build/index.js'

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/bech32.json'), 'utf8')
)

const utf8 = new TextEncoder()

const hexToBytes32 = (hex) => {
  const bytes = hexToBytes(hex)
  assert.equal(bytes.length, 32)
  return bytes
}

const encodeNofferTlv = (fields) => {
  const tlv = {}
  tlv[0] = [fields[0]]
  tlv[1] = [utf8.encode(fields[1])]
  tlv[2] = [utf8.encode(fields[2])]
  const entries = []
  for (const [tag, values] of Object.entries(tlv).reverse()) {
    for (const value of values) {
      const entry = new Uint8Array(value.length + 2)
      entry[0] = Number(tag)
      entry[1] = value.length
      entry.set(value, 2)
      entries.push(entry)
    }
  }
  return bech32.encode('noffer', bech32.toWords(concatBytes(...entries)), 5000)
}

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

  it('defaults a noffer without TLV 3 or 4 to spontaneous', () => {
    const { decoded } = fixtures.noffer
    const encoded = encodeNofferTlv({
      0: hexToBytes32(decoded.pubkey),
      1: decoded.relay,
      2: decoded.offer,
    })
    const result = decodeBech32(encoded)
    assert.equal(result.type, 'noffer')
    assert.equal(result.data.priceType, OfferPriceType.Spontaneous)
    assert.equal(result.data.price, undefined)
    assert.equal(result.data.currency, undefined)
  })

  it('round-trips a variable noffer with currency and rejects currency+price', () => {
    const { decoded } = fixtures.noffer
    const pointer = {
      pubkey: decoded.pubkey,
      relay: decoded.relay,
      offer: decoded.offer,
      priceType: OfferPriceType.Variable,
      currency: 'USD',
    }
    const encoded = nofferEncode(pointer)
    const result = decodeBech32(encoded)
    assert.equal(result.type, 'noffer')
    assert.equal(result.data.priceType, OfferPriceType.Variable)
    assert.equal(result.data.currency, 'USD')
    assert.equal(result.data.price, undefined)
    assert.throws(() => nofferEncode({ ...pointer, price: 21 }))
    assert.throws(() => nofferEncode({ ...pointer, priceType: OfferPriceType.Fixed }))
  })
})

const withKelvinSign = (encoded) => {
  const upper = encoded.toUpperCase()
  const at = upper.indexOf('K', upper.lastIndexOf('1') + 1)
  return at < 0 ? null : upper.slice(0, at) + '\u212A' + upper.slice(at + 1)
}

const nprofileWithK = () => {
  for (let n = 0; ; n++) {
    const encoded = nip19.nprofileEncode({ pubkey: n.toString(16).padStart(64, 'b'), relays: ['wss://relay.example'] })
    if (withKelvinSign(encoded)) return encoded
  }
}

describe('nip19 decode', () => {
  it('rejects non-ASCII look-alike characters', () => {
    const encoded = nprofileWithK()
    assert.equal(nip19.decode(encoded).type, 'nprofile')
    assert.equal(nip19.decode(encoded.toUpperCase()).type, 'nprofile')
    assert.throws(() => nip19.decode(withKelvinSign(encoded)))
    assert.throws(() => ClinkSDK.fromNprofile(withKelvinSign(encoded), new Uint8Array(32)))
  })

  it('rejects the same trick in noffer decode', () => {
    const encoded = withKelvinSign(fixtures.noffer.encoded) ?? withKelvinSign(nmanageEncode(fixtures.nmanage.decoded))
    assert.ok(encoded)
    assert.throws(() => decodeBech32(encoded))
  })
})

describe('noffer receipts', () => {
  it('accepts ok with or without a 64-char hex preimage', () => {
    assert.equal(isNofferReceipt({ res: 'ok' }), true)
    assert.equal(isNofferReceipt({ res: 'ok', preimage: 'ab'.repeat(32) }), true)
    assert.equal(isNofferReceipt({ res: 'ok', preimage: 'NOPE' }), false)
    assert.equal(isNofferReceipt({ res: 'GFY' }), false)
    assert.equal(isNofferReceipt({ bolt11: 'lnbc1' }), false)
  })
})
