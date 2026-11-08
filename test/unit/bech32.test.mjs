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
  for (const tag of [3, 4, 5]) {
    if (fields[tag] !== undefined) tlv[tag] = [fields[tag]]
  }
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

  it('rejects a TLV that has a tag but no length byte', () => {
    // noffer1qq225w60 decodes to a single payload byte [0]: tag, no length/value.
    // Without a length-header check, parseTLV would slice(NaN) and loop forever.
    assert.throws(() => decodeBech32('noffer1qq225w60'), /not enough data to read on TLV/)
    assert.throws(() => decodeBech32(bech32.encode('ndebit', bech32.toWords(new Uint8Array([1])), 5000)))
    assert.throws(() => decodeBech32(bech32.encode('nmanage', bech32.toWords(new Uint8Array([2])), 5000)))
  })
})

describe('noffer prices', () => {
  const pointer = { ...fixtures.noffer.decoded, priceType: OfferPriceType.Fixed }
  const fields = {
    0: hexToBytes32(pointer.pubkey),
    1: pointer.relay,
    2: pointer.offer,
  }

  for (const [price, hex] of [
    [0, '00000000'],
    [1, '00000001'],
    [2 ** 32 - 1, 'ffffffff'],
    [2 ** 32, '0100000000'],
    [2 ** 32 + 1, '0100000001'],
    [Number.MAX_SAFE_INTEGER, '1fffffffffffff'],
  ]) {
    it(`losslessly round-trips price ${price} with compatible big-endian bytes`, () => {
      const encoded = nofferEncode({ ...pointer, price })
      assert.equal(encoded, encodeNofferTlv({
        ...fields, 3: new Uint8Array([OfferPriceType.Fixed]), 4: hexToBytes(hex),
      }))
      assert.equal(decodeBech32(encoded).data.price, price)
    })
  }

  it('keeps TLV 4 optional without changing the price type', () => {
    const decoded = decodeBech32(nofferEncode({ ...pointer, price: undefined })).data
    assert.equal(decoded.price, undefined)
    assert.equal(decoded.priceType, OfferPriceType.Fixed)
  })

  it('rejects invalid numeric prices instead of truncating or omitting them', () => {
    for (const price of [NaN, Infinity, -Infinity, -1, -0.5, 0.5, Number.MAX_SAFE_INTEGER + 1, 2 ** 64]) {
      assert.throws(() => nofferEncode({ ...pointer, price }), /nonnegative safe integer/)
    }
  })

  it('rejects empty and unsafe external price TLVs without rounding', () => {
    for (const hex of ['', '20000000000000', '20000000000001', 'ffffffffffffff', 'ff'.repeat(255)]) {
      // 0x20000000000001 is the external seven-byte integer 9007199254740993.
      assert.throws(() => decodeBech32(encodeNofferTlv({ ...fields, 4: hexToBytes(hex) })), /price/)
    }
  })

  it('accepts exact external integer widths and infers fixed pricing even for zero', () => {
    for (const [hex, price] of [['00', 0], ['01', 1], ['001fffffffffffff', Number.MAX_SAFE_INTEGER]]) {
      const decoded = decodeBech32(encodeNofferTlv({ ...fields, 4: hexToBytes(hex) })).data
      assert.equal(decoded.price, price)
      assert.equal(decoded.priceType, OfferPriceType.Fixed)
    }
  })

  it('checks currency and price presence, including zero and empty currency', () => {
    for (const currency of ['USD', '']) {
      const variable = { ...pointer, priceType: OfferPriceType.Variable, currency }
      assert.throws(() => nofferEncode({ ...variable, price: 0 }), /currency excludes price/)
      assert.throws(() => nofferEncode({ ...variable, price: undefined, priceType: OfferPriceType.Fixed }), /currency requires variable/)
      const decoded = decodeBech32(nofferEncode({ ...variable, price: undefined })).data
      assert.equal(decoded.currency, currency)
      assert.equal(decoded.price, undefined)
      assert.equal(decoded.priceType, OfferPriceType.Variable)
      assert.throws(() => decodeBech32(encodeNofferTlv({
        ...fields, 3: new Uint8Array([OfferPriceType.Variable]), 4: hexToBytes('00000000'), 5: utf8.encode(currency),
      })), /currency excludes price/)
      assert.throws(() => decodeBech32(encodeNofferTlv({
        ...fields, 3: new Uint8Array([OfferPriceType.Fixed]), 5: utf8.encode(currency),
      })), /currency requires variable/)
      assert.equal(decodeBech32(encodeNofferTlv({ ...fields, 5: utf8.encode(currency) })).data.priceType, OfferPriceType.Variable)
    }
  })
})

describe('TLV encoding limits', () => {
  const encoders = [
    ['noffer', nofferEncode, fixtures.noffer.decoded, 'offer'],
    ['ndebit', ndebitEncode, fixtures.ndebit.decoded, 'pointer'],
    ['nmanage', nmanageEncode, fixtures.nmanage.decoded, 'pointer'],
  ]

  for (const [kind, encode, pointer, identifier] of encoders) {
    for (const field of [identifier, 'relay']) {
      it(`checks the UTF-8 byte length of ${kind} ${field}`, () => {
        for (const value of ['a'.repeat(255), '\u00e9'.repeat(127) + 'a']) {
          assert.equal(utf8.encode(value).length, 255)
          const expected = { ...pointer, [field]: value }
          const decoded = decodeBech32(encode(expected)).data
          assert.equal(decoded[field], value)
          assert.equal(decoded.pubkey, expected.pubkey)
          assert.equal(decoded.relay, expected.relay)
          assert.equal(decoded[identifier], expected[identifier])
        }
        for (const value of ['a'.repeat(256), 'a'.repeat(257), 'a'.repeat(512), '\u00e9'.repeat(128)]) {
          assert.throws(() => encode({ ...pointer, [field]: value }), /TLV [12] value exceeds 255 bytes/)
        }
      })
    }
  }

  it('also rejects an oversized noffer currency value', () => {
    assert.throws(() => nofferEncode({
      ...fixtures.noffer.decoded, price: undefined,
      priceType: OfferPriceType.Variable, currency: 'a'.repeat(256),
    }), /TLV 5 value exceeds 255 bytes/)
  })

  it('rejects an oversized identifier containing injected routing TLVs', () => {
    const relay = utf8.encode('wss://injected.example')
    const injected = [0, 32, ...new Uint8Array(32).fill(0x41), 1, relay.length, ...relay]
    injected.push(127, 100, ...new Uint8Array(100).fill(0x41))
    const padding = 256 - injected.length - 2
    injected.push(127, padding, ...new Uint8Array(padding).fill(0x41))
    const identifier = String.fromCharCode(...injected)
    assert.equal(utf8.encode(identifier).length, 256)
    // A wrapped length of zero would expose the identifier's bytes as routing TLVs.
    for (const [, encode, pointer, field] of encoders) {
      assert.throws(() => encode({ ...pointer, [field]: identifier }), /TLV 2 value exceeds 255 bytes/)
    }
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
  it('accepts ASCII lower- and uppercase codes with the existing URI prefix handling', () => {
    const profile = nprofileWithK()
    for (const encoded of [profile, nip19.npubEncode('ab'.repeat(32)), nip19.nsecEncode(new Uint8Array(32).fill(1))]) {
      const expected = nip19.decode(encoded)
      for (const code of [encoded, encoded.toUpperCase()]) {
        assert.deepEqual(nip19.decode(code), expected)
        assert.deepEqual(nip19.decodeNostrURI(code), expected)
        assert.deepEqual(nip19.decodeNostrURI(`nostr:${code}`), expected)
      }
      assert.deepEqual(nip19.decodeNostrURI(`NOSTR:${encoded}`), { type: 'invalid', data: null })
    }
  })

  it('rejects non-ASCII look-alike characters', () => {
    const encoded = nprofileWithK()
    assert.equal(nip19.decode(encoded).type, 'nprofile')
    assert.equal(nip19.decode(encoded.toUpperCase()).type, 'nprofile')
    assert.throws(() => nip19.decode(withKelvinSign(encoded)))
    assert.deepEqual(nip19.decodeNostrURI(withKelvinSign(encoded)), { type: 'invalid', data: null })
    assert.deepEqual(nip19.decodeNostrURI(`nostr:${withKelvinSign(encoded)}`), { type: 'invalid', data: null })
    assert.throws(() => ClinkSDK.fromNprofile(withKelvinSign(encoded), new Uint8Array(32)))
  })

  it('preserves invalid URI results and rejects invalid direct decode values', () => {
    const encoded = nprofileWithK()
    for (const value of ['', 'nostr:', 'not-bech32', encoded.slice(0, -1), `N${encoded.slice(1)}`, ` ${encoded}`, `${encoded}\n`, null, undefined, 42, {}]) {
      assert.throws(() => nip19.decode(value))
      assert.deepEqual(nip19.decodeNostrURI(value), { type: 'invalid', data: null })
      assert.deepEqual(nip19.decodeNostrURI(`nostr:${value}`), { type: 'invalid', data: null })
    }
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
