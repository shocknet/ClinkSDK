import { nip44, getPublicKey, finalizeEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
const { getConversationKey, decrypt, encrypt } = nip44

export type RecurringDebitTimeUnit = 'day' | 'week' | 'month'
export type BudgetFrequency = { number: number, unit: RecurringDebitTimeUnit }
export type NdebitData = { pointer?: string, amount_sats?: number, bolt11?: string, frequency?: BudgetFrequency }

export type NdebitSuccess = { res: 'ok' }
export type NdebitSuccessPayment = { res: 'ok', preimage: string }
export type NdebitFailure = { res: 'GFY', error: string, code: number }
export type NdebitResponse = NdebitSuccess | NdebitSuccessPayment | NdebitFailure

export const SendNdebitRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], pubKey: string, data: NdebitData, timeoutSeconds?: number): Promise<NdebitResponse> => {
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
}

export const newNdebitFullAccessRequest = (): NdebitData => {
    return {}
}
export const newNdebitPaymentRequest = (invoice: string, amount?: number): NdebitData => {
    return {
        bolt11: invoice,
        amount_sats: amount
    }
}
export const newNdebitBudgetRequest = (frequency: BudgetFrequency, amount: number): NdebitData => {
    return {
        amount_sats: amount,
        frequency: frequency
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
