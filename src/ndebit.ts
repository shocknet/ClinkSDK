import { randomBytes, bytesToHex } from '@noble/hashes/utils'
import { nip44, getPublicKey } from "nostr-tools"
import { AbstractSimplePool } from "nostr-tools/lib/types/pool"
import { sendRequest } from "./sender.js"
const { getConversationKey, encrypt } = nip44

export type RecurringDebitTimeUnit = 'day' | 'week' | 'month'
export type BudgetFrequency = { number: number, unit: RecurringDebitTimeUnit }
export type NdebitData = { pointer?: string, amount_sats?: number, bolt11?: string, frequency?: BudgetFrequency, k1?: string, description?: string }

const K1_HEX_RE = /^[0-9a-f]{64}$/
const DESC_MAX = 100

export const validateK1 = (k1: unknown): string => {
    if (typeof k1 !== 'string' || !K1_HEX_RE.test(k1)) {
        throw new Error('k1 must be 64 lowercase hex characters')
    }
    return k1
}

/** 32 random bytes as lowercase hex — for minting session ndebit TLV `3`. */
export const generateK1 = (): string => bytesToHex(randomBytes(32))

const assertDescription = (description?: string) => {
    if (description !== undefined && description.length > DESC_MAX) {
        throw new Error('Description must be less than 100 characters')
    }
}

export type NdebitSuccess = { res: 'ok', preimage?: string }
export type NdebitFailure = { res: 'GFY', error: string, code: number }
export type NdebitResponse = NdebitSuccess | NdebitFailure

export const SendNdebitRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NdebitData, timeoutSeconds?: number): Promise<NdebitResponse> => {
    assertDescription(data.description)
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify(data), getConversationKey(privateKey, toPubKey))
    const event = newNdebitEvent(content, publicKey, toPubKey)
    return sendRequest(pool, { privateKey, publicKey }, relays, toPubKey, event, 21002, timeoutSeconds)
}


export const newNdebitFullAccessRequest = (pointer?: string): NdebitData => {
    return {
        pointer: pointer
    }
}
export const newNdebitPaymentRequest = (invoice: string, amount?: number, pointer?: string, k1?: string, description?: string): NdebitData => {
    assertDescription(description)
    const req: NdebitData = {
        bolt11: invoice,
        amount_sats: amount,
        pointer: pointer,
    }
    if (k1 !== undefined) req.k1 = validateK1(k1)
    if (description !== undefined) req.description = description
    return req
}

export const newNdebitBudgetRequest = (frequency: BudgetFrequency, amount: number, pointer?: string, description?: string): NdebitData => {
    assertDescription(description)
    const req: NdebitData = {
        amount_sats: amount,
        frequency: frequency,
        pointer: pointer
    }
    if (description !== undefined) req.description = description
    return req
}

export const newNdebitEvent = (content: string, fromPub: string, toPub: string) => ({
    content,
    created_at: Math.floor(Date.now() / 1000),
    kind: 21002,
    pubkey: fromPub,
    tags: [['p', toPub], ['clink_version', '1']]
})

export const newNdebitFilter = (publicKey: string, eventId: string) => ({
    since: Math.floor(Date.now() / 1000) - 1,
    kinds: [21002],
    '#p': [publicKey],
    '#e': [eventId]
})
