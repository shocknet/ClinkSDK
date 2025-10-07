import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils'
import { bech32 } from '@scure/base'

export const utf8Decoder: TextDecoder = new TextDecoder('utf-8')
export const utf8Encoder: TextEncoder = new TextEncoder()


export type Noffer = `noffer1${string}`
export type Ndebit = `ndebit1${string}`
export type Nmanage = `nmanage1${string}`

/* const NostrTypeGuard = {
  isNoffer: (value?: string | null): value is Noffer => /^noffer1[a-z\d]+$/.test(value || ''),
  isNdebit: (value?: string | null): value is Ndebit => /^ndebit1[a-z\d]+$/.test(value || ''),
} */

export const Bech32MaxSize = 5000

/**
 * Bech32 regex.
 * @see https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki#bech32
 */
export const BECH32_REGEX = /[\x21-\x7E]{1,83}1[023456789acdefghjklmnpqrstuvwxyz]{6,}/

function integerToUint8Array(number: number) {
  // Create a Uint8Array with enough space to hold a 32-bit integer (4 bytes).
  const uint8Array = new Uint8Array(4)

  // Use bitwise operations to extract the bytes.
  uint8Array[0] = (number >> 24) & 0xff // Most significant byte (MSB)
  uint8Array[1] = (number >> 16) & 0xff
  uint8Array[2] = (number >> 8) & 0xff
  uint8Array[3] = number & 0xff // Least significant byte (LSB)

  return uint8Array
}

export type ManagePointer = {
  pubkey: string,
  relay: string,
  pointer?: string,
}

export type OfferPointer = {
  pubkey: string,
  relay: string,
  offer: string
  priceType: OfferPriceType,
  price?: number
}
export enum OfferPriceType {
  Fixed = 0,
  Variable = 1,
  Spontaneous = 2,
}

export type DebitPointer = {
  pubkey: string,
  relay: string,
  pointer?: string,
}

type Prefixes = {
  noffer: OfferPointer
  ndebit: DebitPointer
  nmanage: ManagePointer
}

type DecodeValue<Prefix extends keyof Prefixes> = {
  type: Prefix
  data: Prefixes[Prefix]
}

export type DecodeResult = {
  [P in keyof Prefixes]: DecodeValue<P>
}[keyof Prefixes]

/** @deprecated Use ClinkSDK.decodeBech32 instead. Will be removed in v2.0.0. */
export function decodeBech32<Prefix extends keyof Prefixes>(nip19: `${Prefix}1${string}`): DecodeValue<Prefix>
/** @deprecated Use ClinkSDK.decodeBech32 instead. Will be removed in v2.0.0. */
export function decodeBech32(nip19: string): DecodeResult
export function decodeBech32(nip19: string): DecodeResult {
  let { prefix, words } = bech32.decode(nip19 as `${string}1${string}`, Bech32MaxSize)
  let data = new Uint8Array(bech32.fromWords(words))

  switch (prefix) {
    case 'noffer': {
      const tlv = parseTLV(data)
      if (!tlv[0]?.[0]) throw new Error('missing TLV 0 for noffer')
      if (tlv[0][0].length !== 32) throw new Error('TLV 0 should be 32 bytes')
      if (!tlv[1]?.[0]) throw new Error('missing TLV 1 for noffer')
      if (!tlv[2]?.[0]) throw new Error('missing TLV 2 for noffer')
      if (!tlv[3]?.[0]) throw new Error('missing TLV 3 for noffer')
      return {
        type: 'noffer',
        data: {
          pubkey: bytesToHex(tlv[0][0]),
          relay: utf8Decoder.decode(tlv[1][0]),
          offer: utf8Decoder.decode(tlv[2][0]),
          priceType: tlv[3][0][0],
          price: tlv[4] ? parseInt(bytesToHex(tlv[4][0]), 16) : undefined
        }
      }
    }
    case 'ndebit': {
      const tlv = parseTLV(data)
      if (!tlv[0]?.[0]) throw new Error('missing TLV 0 for ndebit')
      if (tlv[0][0].length !== 32) throw new Error('TLV 0 should be 32 bytes')
      if (!tlv[1]?.[0]) throw new Error('missing TLV 1 for ndebit')
      return {
        type: 'ndebit',
        data: {
          pubkey: bytesToHex(tlv[0][0]),
          relay: utf8Decoder.decode(tlv[1][0]),
          pointer: tlv[2] ? utf8Decoder.decode(tlv[2][0]) : undefined
        }
      }
    }
    case 'nmanage': {
      const tlv = parseTLV(data)
      if (!tlv[0]?.[0]) throw new Error('missing TLV 0 for nmanage')
      if (tlv[0][0].length !== 32) throw new Error('TLV 0 should be 32 bytes')
      if (!tlv[1]?.[0]) throw new Error('missing TLV 1 for nmanage')
      return {
        type: 'nmanage',
        data: {
          pubkey: bytesToHex(tlv[0][0]),
          relay: utf8Decoder.decode(tlv[1][0]),
          pointer: tlv[2] ? utf8Decoder.decode(tlv[2][0]) : undefined
        }
      }
    }
    default:
      throw new Error(`unknown prefix ${prefix}`)
  }
}

type TLV = { [t: number]: Uint8Array[] }

function parseTLV(data: Uint8Array): TLV {
  let result: TLV = {}
  let rest = data
  while (rest.length > 0) {
    let t = rest[0]
    let l = rest[1]
    let v = rest.slice(2, 2 + l)
    rest = rest.slice(2 + l)
    if (v.length < l) throw new Error(`not enough data to read on TLV ${t}`)
    result[t] = result[t] || []
    result[t].push(v)
  }
  return result
}


export const nofferEncode = (offer: OfferPointer): string => {
  const o: TLV = {
    0: [hexToBytes(offer.pubkey)],
    1: [utf8Encoder.encode(offer.relay)],
    2: [utf8Encoder.encode(offer.offer)],
    3: [new Uint8Array([Number(offer.priceType)])],
  }
  if (offer.price) {
    o[4] = [integerToUint8Array(offer.price)]
  }
  const data = encodeTLV(o)
  const words = bech32.toWords(data)
  return bech32.encode('noffer', words, 5000)
}

export const ndebitEncode = (debit: DebitPointer): string => {
  const o: TLV = {
    0: [hexToBytes(debit.pubkey)],
    1: [utf8Encoder.encode(debit.relay)],
  }
  if (debit.pointer) {
    o[2] = [utf8Encoder.encode(debit.pointer)]
  }
  const data = encodeTLV(o)
  const words = bech32.toWords(data)
  return bech32.encode('ndebit', words, 5000)
}

export const nmanageEncode = (manage: ManagePointer): string => {
  const o: TLV = {
    0: [hexToBytes(manage.pubkey)],
    1: [utf8Encoder.encode(manage.relay)],
  }
  if (manage.pointer) {
    o[2] = [utf8Encoder.encode(manage.pointer)]
  }
  const data = encodeTLV(o)
  const words = bech32.toWords(data)
  return bech32.encode('nmanage', words, 5000)
}

function encodeTLV(tlv: TLV): Uint8Array {
  let entries: Uint8Array[] = []

  Object.entries(tlv)
    .reverse()
    .forEach(([t, vs]) => {
      vs.forEach(v => {
        let entry = new Uint8Array(v.length + 2)
        entry.set([parseInt(t)], 0)
        entry.set([v.length], 1)
        entry.set(v, 2)
        entries.push(entry)
      })
    })

  return concatBytes(...entries)
}
