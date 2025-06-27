import { nip44, getPublicKey, finalizeEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { sendRequest } from "./sender"
const { getConversationKey, decrypt, encrypt } = nip44

export type NofferData = { offer: string, amount?: number, zap?: string, payer_data?: any }
export type NofferSuccess = { bolt11: string }
export type NofferError = { code: number, error: string, range: { min: number, max: number } }
export type NofferResponse = NofferSuccess | NofferError

/* export const SendNofferRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NofferData, timeoutSeconds = 30): Promise<NofferResponse> => {
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify(data), getConversationKey(privateKey, toPubKey))
    const event = newNofferEvent(content, publicKey, toPubKey)
    const signed = finalizeEvent(event, privateKey)
    await Promise.all(pool.publish(relays, signed))
    return new Promise<NofferResponse>((res, rej) => {
        let closer: SubCloser = { close: () => { } }
        const timeout = setTimeout(() => {
            closer.close(); rej("failed to get noffer response in time")
        }, timeoutSeconds * 1000)

        closer = pool.subscribeMany(relays, [newNofferFilter(publicKey, signed.id)], {
            onevent: async (e) => {
                clearTimeout(timeout)
                const content = decrypt(e.content, getConversationKey(privateKey, toPubKey))
                res(JSON.parse(content))
            }
        })
    })
} */

export const SendNofferRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NofferData, timeoutSeconds = 30): Promise<NofferResponse> => {
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify(data), getConversationKey(privateKey, toPubKey))
    const event = newNofferEvent(content, publicKey, toPubKey)
    return sendRequest(pool, { privateKey, publicKey }, relays, toPubKey, event, 21001, timeoutSeconds)
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