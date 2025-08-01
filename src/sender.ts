import { nip44, finalizeEvent, UnsignedEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
const { getConversationKey, decrypt } = nip44

type Pair = { privateKey: Uint8Array, publicKey: string }
export const sendRequest = async <T>(pool: AbstractSimplePool, pair: Pair, relays: string[], toPub: string, e: UnsignedEvent, kindExpected: number, timeoutSeconds?: number, moreCb?: (data: any) => void): Promise<T> => {
    const signed = finalizeEvent(e, pair.privateKey)
    await Promise.all(pool.publish(relays, signed))
    return new Promise<T>((res, rej) => {
        let resolved = false
        let closer: SubCloser = { close: () => { } }
        let timer: NodeJS.Timeout | null = null
        if (timeoutSeconds) {
            timer = setTimeout(() => {
                closer.close(); rej('failed to get ndebit response in time')
            }, timeoutSeconds * 1000)
        }
        closer = pool.subscribeMany(relays, [newFilter(pair.publicKey, signed.id, kindExpected)], {
            onevent: async (e) => {
                if (timer) clearTimeout(timer)
                const content = decrypt(e.content, getConversationKey(pair.privateKey, toPub))
                if (!resolved) {
                    resolved = true
                    res(JSON.parse(content))
                } else {
                    moreCb?.(JSON.parse(content))
                }
            }
        })
    })
}

export const newFilter = (publicKey: string, eventId: string, kindExpected: number) => ({
    since: Math.floor(Date.now() / 1000) - 1,
    kinds: [kindExpected],
    '#p': [publicKey],
    '#e': [eventId]
})