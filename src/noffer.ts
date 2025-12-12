import { nip44, getPublicKey } from "nostr-tools"
import { AbstractSimplePool } from "nostr-tools/lib/types/pool"
import { sendRequest } from "./sender.js"
const { getConversationKey, encrypt } = nip44

export type NofferData = { offer: string, amount_sats?: number, zap?: string, payer_data?: any, expires_in_seconds?:number, description?:string }
export type NofferSuccess = { bolt11: string }
export type NofferError = { code: number, error: string, range?: { min: number, max: number } }
export type NofferResponse = NofferSuccess | NofferError
export type NofferReceipt = { res: 'ok' }

export const SendNofferRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NofferData, timeoutSeconds = 30, onReceipt?: (receipt: NofferReceipt) => void): Promise<NofferResponse> => {
    if (data.description && data.description.length > 100) {
        throw new Error('Description must be less than 100 characters')
    }
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify(data), getConversationKey(privateKey, toPubKey))
    const event = newNofferEvent(content, publicKey, toPubKey)
    return sendRequest(pool, { privateKey, publicKey }, relays, toPubKey, event, 21001, timeoutSeconds, onReceipt)
}

export const newNofferEvent = (content: string, fromPub: string, toPub: string) => ({
    content,
    created_at: Math.floor(Date.now() / 1000),
    kind: 21001,
    pubkey: fromPub,
    tags: [['p', toPub], ['clink_version', '1']]
})

export const newNofferFilter = (publicKey: string, eventId: string) => ({
    since: Math.floor(Date.now() / 1000) - 1,
    kinds: [21001],
    '#p': [publicKey],
    '#e': [eventId]
})