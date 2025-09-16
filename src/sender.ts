import { nip44, finalizeEvent, UnsignedEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
const { getConversationKey, decrypt } = nip44

type Pair = { privateKey: Uint8Array, publicKey: string }
export const sendRequest = async <T>(pool: AbstractSimplePool, pair: Pair, relays: string[], toPub: string, e: UnsignedEvent, kindExpected: number, timeoutSeconds?: number, moreCb?: (data: any) => void): Promise<T> => {
    const signed = finalizeEvent(e, pair.privateKey)
    console.log(`[ClinkSDK] Sending request: kind=${kindExpected}, eventId=${signed.id}, toPub=${toPub}, relays=${relays.join(',')}, timeout=${timeoutSeconds}s`)
    
    try {
        await Promise.all(pool.publish(relays, signed))
        console.log(`[ClinkSDK] Request published to ${relays.length} relays, waiting for response...`)
    } catch (error) {
        console.error(`[ClinkSDK] Failed to publish to relays:`, error)
        throw error
    }
    
    return new Promise<T>((res, rej) => {
        let resolved = false
        let closer: SubCloser = { close: () => { } }
        let timer: NodeJS.Timeout | null = null
        
        const filter = newFilter(pair.publicKey, signed.id, kindExpected)
        console.log(`[ClinkSDK] Setting up subscription with filter:`, JSON.stringify(filter, null, 2))
        
        if (timeoutSeconds) {
            timer = setTimeout(() => {
                console.log(`[ClinkSDK] Timeout after ${timeoutSeconds}s - no response received for kind=${kindExpected}, eventId=${signed.id}`)
                console.log(`[ClinkSDK] Closing subscription for eventId=${signed.id}`)
                closer.close(); rej('failed to get response in time')
            }, timeoutSeconds * 1000)
        }
        
        try {
            closer = pool.subscribeMany(relays, [filter], {
                onevent: async (e) => {
                    console.log(`[ClinkSDK] Received response event: kind=${e.kind}, eventId=${e.id}, from=${e.pubkey}`)
                    if (timer) clearTimeout(timer)
                    const content = decrypt(e.content, getConversationKey(pair.privateKey, toPub))
                    if (!resolved) {
                        resolved = true
                        console.log(`[ClinkSDK] Response resolved successfully for eventId=${signed.id}`)
                        res(JSON.parse(content))
                    } else {
                        console.log(`[ClinkSDK] Additional response received for eventId=${signed.id}, calling moreCb`)
                        moreCb?.(JSON.parse(content))
                    }
                },
                oneose: () => {
                    console.log(`[ClinkSDK] End of stored events received for eventId=${signed.id}`)
                }
            })
            console.log(`[ClinkSDK] Subscription established for eventId=${signed.id}`)
        } catch (error) {
            console.error(`[ClinkSDK] Failed to establish subscription:`, error)
            if (timer) clearTimeout(timer)
            rej(error)
        }
    })
}

export const newFilter = (publicKey: string, eventId: string, kindExpected: number) => ({
    since: Math.floor(Date.now() / 1000) - 1,
    kinds: [kindExpected],
    '#p': [publicKey],
    '#e': [eventId]
})