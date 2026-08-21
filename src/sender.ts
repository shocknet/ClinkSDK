import { nip44, finalizeEvent, verifyEvent, UnsignedEvent, type Event } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { CLINK_VERSION } from "./constants.js"
import { isNofferReceipt } from "./receipt.js"
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

const firstTag = (tags: string[][], name: string): string | undefined =>
    tags.find(t => t[0] === name)?.[1]

const hexEq = (a: string, b: string): boolean =>
    a.toLowerCase() === b.toLowerCase()

type ResponseExpect = {
    pubkey: string
    kind: number
    requestorPub: string
    requestId: string
}

/** Accept only a signed CLINK reply from the expected peer, tagged to this request. */
export const isClinkResponse = (event: Event, expect: ResponseExpect): boolean => {
    if (event.kind !== expect.kind) {
        return false
    }
    if (!hexEq(event.pubkey, expect.pubkey)) {
        return false
    }
    if (!verifyEvent(event)) {
        return false
    }
    if (firstTag(event.tags, "clink_version") !== CLINK_VERSION) {
        return false
    }
    if (!hexEq(firstTag(event.tags, "p") ?? "", expect.requestorPub)) {
        return false
    }
    return (firstTag(event.tags, "e") ?? "") === expect.requestId
}

type Pair = { privateKey: Uint8Array, publicKey: string }

const RECEIPT_RESUBSCRIBE_MS = 4000
const RELISTEN_MS = 500

export const sendRequest = async <T>(pool: AbstractSimplePool, pair: Pair, relays: string[], toPub: string, e: UnsignedEvent, kindExpected: number, timeoutSeconds?: number, moreCb?: (data: any) => void): Promise<T> => {
    const signed = finalizeEvent(e, pair.privateKey)
    // Wire events use lowercase hex; callers sometimes pass mixed case.
    const expectedPub = toPub.toLowerCase()
    const expect: ResponseExpect = {
        pubkey: expectedPub,
        kind: kindExpected,
        requestorPub: pair.publicKey,
        requestId: signed.id,
    }
    log(`[ClinkSDK] Sending request: kind=${kindExpected}, eventId=${signed.id}, toPub=${expectedPub}, relays=${relays.join(',')}, timeout=${timeoutSeconds}s`)

    return new Promise<T>((res, rej) => {
        let settled = false
        let finished = false
        let listenGen = 0
        let closer: SubCloser = { close: () => { } }
        let timer: ReturnType<typeof setTimeout> | null = null
        let relistenTimer: ReturnType<typeof setTimeout> | null = null
        let resubTimer: ReturnType<typeof setInterval> | null = null
        const filter = newFilter(pair.publicKey, signed.id, kindExpected)

        const stopTimers = () => {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            if (relistenTimer) {
                clearTimeout(relistenTimer)
                relistenTimer = null
            }
            if (resubTimer) {
                clearInterval(resubTimer)
                resubTimer = null
            }
        }

        const cleanup = () => {
            if (finished) {
                return
            }
            finished = true
            stopTimers()
            closer.close()
        }

        const fail = (err: unknown) => {
            if (settled) {
                return
            }
            settled = true
            cleanup()
            rej(err)
        }

        const waitForReceipt = () => {
            if (resubTimer) {
                return
            }
            resubTimer = setInterval(listen, RECEIPT_RESUBSCRIBE_MS)
        }

        const listen = () => {
            if (finished) {
                return
            }
            const gen = ++listenGen
            log(`[ClinkSDK] Setting up subscription with filter:`, JSON.stringify(filter, null, 2))
            closer.close()
            closer = pool.subscribeMany(relays, [filter], {
                onevent: async (event) => {
                    log(`[ClinkSDK] Received response event: kind=${event.kind}, eventId=${event.id}, from=${event.pubkey}`)
                    if (!isClinkResponse(event, expect)) {
                        log(`[ClinkSDK] Ignoring event that is not a valid CLINK response for eventId=${signed.id}`)
                        return
                    }
                    try {
                        const content = decrypt(event.content, getConversationKey(pair.privateKey, expectedPub))
                        const parsed = JSON.parse(content)
                        if (!settled) {
                            settled = true
                            if (timer) {
                                clearTimeout(timer)
                                timer = null
                            }
                            log(`[ClinkSDK] Response resolved successfully for eventId=${signed.id}`)
                            res(parsed)
                            if (!moreCb) {
                                cleanup()
                                return
                            }
                            waitForReceipt()
                        } else if (moreCb && isNofferReceipt(parsed)) {
                            log(`[ClinkSDK] Receipt received for eventId=${signed.id}, calling moreCb`)
                            moreCb(parsed)
                            cleanup()
                        } else {
                            log(`[ClinkSDK] Ignoring extra non-receipt event for eventId=${signed.id}`)
                        }
                    } catch (err) {
                        logError(`[ClinkSDK] Failed to decrypt/parse response for eventId=${signed.id}:`, err)
                        if (!settled) {
                            fail(err)
                        }
                    }
                },
                oneose: () => {
                    log(`[ClinkSDK] End of stored events received for eventId=${signed.id}`)
                },
                onclose: () => {
                    if (finished || gen !== listenGen) {
                        return
                    }
                    log(`[ClinkSDK] Subscription closed, listening again for eventId=${signed.id}`)
                    relistenTimer = setTimeout(listen, RELISTEN_MS)
                },
            })
        }

        if (timeoutSeconds) {
            timer = setTimeout(() => {
                log(`[ClinkSDK] Timeout after ${timeoutSeconds}s - no response received for kind=${kindExpected}, eventId=${signed.id}`)
                fail('failed to get response in time')
            }, timeoutSeconds * 1000)
        }

        try {
            listen()
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
