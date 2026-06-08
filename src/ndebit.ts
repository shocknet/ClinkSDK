import { randomBytes, bytesToHex } from '@noble/hashes/utils'
import { nip44, getPublicKey, finalizeEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { sendRequest } from "./sender.js"
const { getConversationKey, decrypt, encrypt } = nip44

export type RecurringDebitTimeUnit = 'day' | 'week' | 'month'
export type BudgetFrequency = { number: number, unit: RecurringDebitTimeUnit }
export type NdebitData = { pointer?: string, amount_sats?: number, bolt11?: string, frequency?: BudgetFrequency, k1?: string }

const K1_HEX_RE = /^[0-9a-f]{64}$/

export const validateK1 = (k1: unknown): string => {
    if (typeof k1 !== 'string' || !K1_HEX_RE.test(k1)) {
        throw new Error('k1 must be 64 lowercase hex characters')
    }
    return k1
}

/** 32 random bytes as lowercase hex — for minting session ndebit TLV `3`. */
export const generateK1 = (): string => bytesToHex(randomBytes(32))

export const validateNdebitData = (data: unknown): NdebitData => {
    if (typeof data !== 'object' || data === null) throw new Error('data must be an object')
    if ('pointer' in data && typeof data.pointer !== 'string') throw new Error('pointer must be a string if present')
    if ('amount_sats' in data && typeof data.amount_sats !== 'number') throw new Error('amount_sats must be a number if present')
    if ('bolt11' in data && typeof data.bolt11 !== 'string') throw new Error('bolt11 must be a string if present')
    if ('frequency' in data) validateBudgetFrequency(data.frequency)
    if ('k1' in data) validateK1(data.k1)
    return data as NdebitData
}

export const validateBudgetFrequency = (frequency: unknown): BudgetFrequency => {
    if (typeof frequency !== 'object' || frequency === null) throw new Error('frequency must be an object')
    if (!('number' in frequency) || typeof frequency.number !== 'number') throw new Error('frequency.number must be a number')
    if (frequency.number <= 0 || !Number.isInteger(frequency.number)) throw new Error('frequency.number must be a positive integer')
    if (!('unit' in frequency) || typeof frequency.unit !== 'string') throw new Error('frequency.unit must be a string')
    if (frequency.unit !== 'day' && frequency.unit !== 'week' && frequency.unit !== 'month') throw new Error('frequency.unit must be day, week, or month')
    return frequency as BudgetFrequency
}

export type NdebitSuccess = { res: 'ok', preimage?: string }
export type NdebitFailure = { res: 'GFY', error: string, code: number }
export type NdebitResponse = NdebitSuccess | NdebitFailure

/* export const SendNdebitRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], pubKey: string, data: NdebitData, timeoutSeconds?: number): Promise<NdebitResponse> => {
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify(data), getConversationKey(privateKey, pubKey))
    const event = newNdebitEvent(content, publicKey, pubKey)
    const signed = finalizeEvent(event, privateKey)
    await Promise.all(pool.publish(relays, signed))
    return new Promise<NdebitResponse>((res, rej) => {
        let closer: SubCloser = { close: () => { } }
        let timer: NodeJS.Timeout | null = null
        if (timeoutSeconds) {
            timer = setTimeout(() => {
                closer.close(); rej('failed to get ndebit response in time')
            }, timeoutSeconds * 1000)
        }
        closer = pool.subscribeMany(relays, [newNdebitFilter(publicKey, signed.id)], {
            onevent: async (e) => {
                if (timer) clearTimeout(timer)
                const content = decrypt(e.content, getConversationKey(privateKey, pubKey))
                res(JSON.parse(content))
            }
        })
    })
} */

export const SendNdebitRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NdebitData, timeoutSeconds?: number): Promise<NdebitResponse> => {
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
export const newNdebitPaymentRequest = (invoice: string, amount?: number, pointer?: string, k1?: string): NdebitData => {
    const req: NdebitData = {
        bolt11: invoice,
        amount_sats: amount,
        pointer: pointer,
    }
    if (k1 !== undefined) req.k1 = validateK1(k1)
    return req
}

export const newNdebitBudgetRequest = (frequency: BudgetFrequency, amount: number, pointer?: string): NdebitData => {
    return {
        amount_sats: amount,
        frequency: frequency,
        pointer: pointer
    }
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
