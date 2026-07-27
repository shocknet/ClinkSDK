import { nip44, finalizeEvent, UnsignedEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
const { getConversationKey, decrypt } = nip44

let debug = false

/** Enable verbose relay lifecycle logs (default off) — handy while integrating. */
export const setDebug = (enabled: boolean) => {
    debug = enabled
}

const log = (...args: unknown[]) => {
    if (debug) console.log(...args)
}

const logError = (...args: unknown[]) => {
    if (debug) console.error(...args)
}

type Pair = { privateKey: Uint8Array, publicKey: string }
export const sendRequest = async <T>(pool: AbstractSimplePool, pair: Pair, relays: string[], toPub: string, e: UnsignedEvent, kindExpected: number, timeoutSeconds?: number, moreCb?: (data: any) => void): Promise<T> => {
    const signed = finalizeEvent(e, pair.privateKey)
    // Wire events use lowercase hex; callers sometimes pass mixed case.
    const expectedPub = toPub.toLowerCase()
    log(`[ClinkSDK] Sending request: kind=${kindExpected}, eventId=${signed.id}, toPub=${expectedPub}, relays=${relays.join(',')}, timeout=${timeoutSeconds}s`)

    return new Promise<T>((res, rej) => {
        let settled = false
        let closer: SubCloser = { close: () => { } }
        let timer: ReturnType<typeof setTimeout> | null = null

        const filter = newFilter(pair.publicKey, signed.id, kindExpected)
        log(`[ClinkSDK] Setting up subscription with filter:`, JSON.stringify(filter, null, 2))

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            closer.close()
        }

        const fail = (err: unknown) => {
            if (settled) return
            settled = true
            cleanup()
            rej(err)
        }

        if (timeoutSeconds) {
            timer = setTimeout(() => {
                log(`[ClinkSDK] Timeout after ${timeoutSeconds}s - no response received for kind=${kindExpected}, eventId=${signed.id}`)
                fail('failed to get response in time')
            }, timeoutSeconds * 1000)
        }

        try {
            // Subscribe BEFORE publish — otherwise a fast reply can arrive with no listener
            closer = pool.subscribeMany(relays, [filter], {
                onevent: async (e) => {
                    log(`[ClinkSDK] Received response event: kind=${e.kind}, eventId=${e.id}, from=${e.pubkey}`)
                    // Filter is tag-based only — ignore anyone who is not the expected peer so a
                    // forged #e/#p event cannot DoS the request by failing decrypt ahead of the real reply.
                    if (e.pubkey !== expectedPub) {
                        log(`[ClinkSDK] Ignoring event from unexpected pubkey ${e.pubkey} (expected ${expectedPub})`)
                        return
                    }
                    try {
                        const content = decrypt(e.content, getConversationKey(pair.privateKey, expectedPub))
                        const parsed = JSON.parse(content)
                        if (!settled) {
                            settled = true
                            if (timer) {
                                clearTimeout(timer)
                                timer = null
                            }
                            log(`[ClinkSDK] Response resolved successfully for eventId=${signed.id}`)
                            res(parsed)
                            // Keep the sub open only when a follow-up is expected (e.g. Noffer payment receipt)
                            if (!moreCb) cleanup()
                        } else {
                            // Single receipt — invoke callback then close
                            log(`[ClinkSDK] Additional response received for eventId=${signed.id}, calling moreCb`)
                            moreCb?.(parsed)
                            cleanup()
                        }
                    } catch (err) {
                        logError(`[ClinkSDK] Failed to decrypt/parse response for eventId=${signed.id}:`, err)
                        if (!settled) {
                            fail(err)
                        } else {
                            // Primary already delivered; bad follow-up — just close
                            cleanup()
                        }
                    }
                },
                oneose: () => {
                    log(`[ClinkSDK] End of stored events received for eventId=${signed.id}`)
                }
            })
            log(`[ClinkSDK] Subscription established for eventId=${signed.id}`)

            Promise.all(pool.publish(relays, signed)).then(() => {
                log(`[ClinkSDK] Request published to ${relays.length} relays, waiting for response...`)
            }).catch((error) => {
                logError(`[ClinkSDK] Failed to publish to relays:`, error)
                fail(error)
            })
        } catch (error) {
            logError(`[ClinkSDK] Failed to establish subscription:`, error)
            fail(error)
        }
    })
}

export const newFilter = (publicKey: string, eventId: string, kindExpected: number) => ({
    since: Math.floor(Date.now() / 1000) - 1,
    kinds: [kindExpected],
    '#p': [publicKey],
    '#e': [eventId]
})
