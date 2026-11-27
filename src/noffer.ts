import { nip44, getPublicKey } from "nostr-tools"
import type { AbstractSimplePool } from "nostr-tools/lib/types/abstract-pool"
import { CLINK_OFFER_KIND, CLINK_VERSION } from "./constants.js"
import { type NofferReceipt } from "./receipt.js"
import { sendRequest } from "./sender.js"
export type { NofferReceipt } from "./receipt.js"
export { isNofferReceipt } from "./receipt.js"
const { getConversationKey, encrypt } = nip44

export type NofferPayerData = Record<string, string | number> & { quantity?: number }

export type NofferData = {
    offer: string
    amount_sats?: number
    zap?: string
    payer_data?: NofferPayerData
    expires_in_seconds?: number
    description?: string
}

export const validateNofferData = (data: unknown): NofferData => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('data must be an object')
    const { offer, amount_sats, zap, payer_data, expires_in_seconds, description } = data as Record<string, unknown>
    if (typeof offer !== 'string') throw new Error('offer must be a string')
    if (offer.length === 0) throw new Error('offer must not be empty')
    const out: NofferData = { offer }
    if (amount_sats !== undefined) {
        if (typeof amount_sats !== 'number' || !Number.isSafeInteger(amount_sats) || amount_sats <= 0) {
            throw new Error('amount_sats must be a positive safe integer if present')
        }
        out.amount_sats = amount_sats
    }
    if (zap !== undefined) {
        if (typeof zap !== 'string') throw new Error('zap must be a string if present')
        out.zap = zap
    }
    if (payer_data !== undefined) {
        if (typeof payer_data !== 'object' || payer_data === null || Array.isArray(payer_data)) {
            throw new Error('payer_data must be an object if present')
        }
        const entries: [string, string | number][] = []
        for (const [key, value] of Object.entries(payer_data)) {
            if (value === undefined) continue
            if (key === 'quantity') {
                if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
                    throw new Error('payer_data.quantity must be a positive safe integer')
                }
            } else if (typeof value !== 'string') {
                throw new Error(`payer_data.${key} must be a string`)
            }
            entries.push([key, value])
        }
        out.payer_data = Object.fromEntries(entries) as NofferPayerData
    }
    if (expires_in_seconds !== undefined) {
        if (typeof expires_in_seconds !== 'number' || !Number.isSafeInteger(expires_in_seconds) || expires_in_seconds < 0) {
            throw new Error('expires_in_seconds must be a non-negative safe integer if present')
        }
        out.expires_in_seconds = expires_in_seconds
    }
    if (description !== undefined) {
        if (typeof description !== 'string') throw new Error('description must be a string if present')
        if (description.length > 100) throw new Error('Description must be less than 100 characters')
        out.description = description
    }
    return out
}

export type NofferSuccess = { bolt11: string }
export type NofferError = { code: number, error: string, range?: { min: number, max: number }, latest?: string, payer_data?: string[] }
export type NofferResponse = NofferSuccess | NofferError

export const SendNofferRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NofferData, timeoutSeconds = 30, onReceipt?: (receipt: NofferReceipt) => void, signal?: AbortSignal): Promise<NofferResponse> => {
    signal?.throwIfAborted()
    const payload = validateNofferData(data)
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify(payload), getConversationKey(privateKey, toPubKey))
    const event = newNofferEvent(content, publicKey, toPubKey)
    return sendRequest(pool, { privateKey, publicKey }, relays, toPubKey, event, CLINK_OFFER_KIND, timeoutSeconds, onReceipt, signal)
}

export const newNofferEvent = (content: string, fromPub: string, toPub: string) => ({
    content,
    created_at: Math.floor(Date.now() / 1000),
    kind: CLINK_OFFER_KIND,
    pubkey: fromPub,
    tags: [['p', toPub], ['clink_version', CLINK_VERSION]]
})

export const newNofferFilter = (publicKey: string, eventId: string) => ({
    since: Math.floor(Date.now() / 1000) - 1,
    kinds: [CLINK_OFFER_KIND],
    '#p': [publicKey],
    '#e': [eventId]
})
