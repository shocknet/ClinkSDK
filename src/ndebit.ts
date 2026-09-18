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

export const validateBudgetFrequency = (frequency: unknown): BudgetFrequency => {
    if (typeof frequency !== 'object' || frequency === null || Array.isArray(frequency)) throw new Error('frequency must be an object')
    if (!('number' in frequency) || typeof frequency.number !== 'number') throw new Error('frequency.number must be a number')
    if (frequency.number <= 0 || !Number.isSafeInteger(frequency.number)) throw new Error('frequency.number must be a positive integer')
    if (!('unit' in frequency) || typeof frequency.unit !== 'string') throw new Error('frequency.unit must be a string')
    if (frequency.unit !== 'day' && frequency.unit !== 'week' && frequency.unit !== 'month') {
        throw new Error('frequency.unit must be day, week, or month')
    }
    return frequency as BudgetFrequency
}

const defined = (rec: Record<string, unknown>, key: string): boolean =>
    rec[key] !== undefined

const assertAmountSats = (n: unknown): number => {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) {
        throw new Error('amount_sats must be a positive integer')
    }
    return n
}

const assertBolt11 = (bolt11: unknown): string => {
    if (typeof bolt11 !== 'string' || bolt11.length === 0) {
        throw new Error('bolt11 must be a non-empty string if present')
    }
    return bolt11
}

export const validateNdebitData = (data: unknown): NdebitData => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('data must be an object')
    const rec = data as Record<string, unknown>
    if (defined(rec, 'pointer') && typeof rec.pointer !== 'string') throw new Error('pointer must be a string if present')
    if (defined(rec, 'amount_sats')) assertAmountSats(rec.amount_sats)
    if (defined(rec, 'bolt11')) assertBolt11(rec.bolt11)
    if (defined(rec, 'description')) {
        if (typeof rec.description !== 'string') throw new Error('description must be a string if present')
        assertDescription(rec.description)
    }

    const bolt11 = defined(rec, 'bolt11') ? rec.bolt11 as string : undefined
    const hasFrequency = defined(rec, 'frequency')
    const hasAmount = defined(rec, 'amount_sats')
    const hasK1 = defined(rec, 'k1')

    if (hasK1) {
        validateK1(rec.k1)
        if (!bolt11 || hasFrequency) {
            throw new Error('k1 requires a bolt11 payment request')
        }
    }
    if (hasFrequency) {
        if (bolt11) {
            throw new Error('frequency cannot be combined with bolt11')
        }
        if (!hasAmount) {
            throw new Error('frequency requires amount_sats')
        }
        validateBudgetFrequency(rec.frequency)
    }

    const out: NdebitData = {}
    if (defined(rec, 'pointer')) out.pointer = rec.pointer as string
    if (hasAmount) out.amount_sats = rec.amount_sats as number
    if (bolt11) out.bolt11 = bolt11
    if (hasFrequency) out.frequency = rec.frequency as BudgetFrequency
    if (hasK1) out.k1 = rec.k1 as string
    if (defined(rec, 'description')) out.description = rec.description as string
    return out
}

const assertDescription = (description?: string) => {
    if (description !== undefined && description.length > DESC_MAX) {
        throw new Error('Description must be less than 100 characters')
    }
}

export type NdebitSuccess = { res: 'ok', preimage?: string }
export const gfy6Reason = {
    k1AlreadyProcessed: 'k1_already_processed',
    invoiceInProgress: 'invoice_in_progress',
    invoiceAlreadyFailed: 'invoice_already_failed',
    invoiceAlreadyPaid: 'invoice_already_paid',
} as const
export type Gfy6Reason = typeof gfy6Reason[keyof typeof gfy6Reason]
export type NdebitFailure = {
    res: 'GFY'
    error: string
    code: number
    reason?: Gfy6Reason
    delta?: { max_delta_ms: number, actual_delta_ms: number }
    retry_after?: number
    range?: { min: number, max: number }
}
export type NdebitResponse = NdebitSuccess | NdebitFailure

export const SendNdebitRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NdebitData, timeoutSeconds?: number): Promise<NdebitResponse> => {
    const payload = validateNdebitData(data)
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify(payload), getConversationKey(privateKey, toPubKey))
    const event = newNdebitEvent(content, publicKey, toPubKey)
    return sendRequest(pool, { privateKey, publicKey }, relays, toPubKey, event, 21002, timeoutSeconds)
}


export const newNdebitFullAccessRequest = (pointer?: string): NdebitData => {
    const req: NdebitData = {}
    if (pointer !== undefined) req.pointer = pointer
    return req
}
export const newNdebitPaymentRequest = (invoice: string, amount?: number, pointer?: string, k1?: string, description?: string): NdebitData => {
    assertDescription(description)
    const req: NdebitData = {
        bolt11: assertBolt11(invoice),
    }
    if (amount !== undefined) req.amount_sats = assertAmountSats(amount)
    if (pointer !== undefined) req.pointer = pointer
    if (k1 !== undefined) req.k1 = validateK1(k1)
    if (description !== undefined) req.description = description
    return req
}

export const newNdebitBudgetRequest = (frequency: BudgetFrequency, amount: number, pointer?: string, description?: string): NdebitData => {
    assertDescription(description)
    const req: NdebitData = {
        amount_sats: assertAmountSats(amount),
        frequency: validateBudgetFrequency(frequency),
    }
    if (pointer !== undefined) req.pointer = pointer
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
