import { nip44, getPublicKey, finalizeEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { sendRequest } from "./sender.js"
const { getConversationKey, decrypt, encrypt } = nip44

export type RecurringDebitTimeUnit = 'day' | 'week' | 'month'
export type BudgetFrequency = { number: number, unit: RecurringDebitTimeUnit }
export type NdebitData = { pointer?: string, amount_sats?: number, bolt11?: string, frequency?: BudgetFrequency }

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
export const newNdebitPaymentRequest = (invoice: string, amount?: number, pointer?: string): NdebitData => {
    return {
        bolt11: invoice,
        amount_sats: amount,
        pointer: pointer
    }
}

/** @deprecated Use ClinkSDK.newNdebitBudgetRequest instead. Will be removed in v2.0.0. */
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
