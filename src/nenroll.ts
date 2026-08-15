import { nip44, getPublicKey, type UnsignedEvent } from "nostr-tools"
import { AbstractSimplePool } from "nostr-tools/lib/types/pool"
import { sendRequest } from "./sender.js"
import { CLINK_ENROLL_KIND, CLINK_VERSION } from "./constants.js"
import { mineNip13 } from "./nip13.js"

const { getConversationKey, encrypt } = nip44

export type NenrollSuccess = { res: "ok", noffer: string, ndebit: string, nmanage: string }
export type NenrollFailure = {
    res: "GFY"
    code: number
    error: string
    required_difficulty?: number
    retry_after?: number
    delta?: { max_delta_ms: number, actual_delta_ms: number }
}
export type NenrollResponse = NenrollSuccess | NenrollFailure

export type NenrollOptions = {
    /** NIP-13 bits to mine before send. `0` probes. Omit to let the caller pick (beacon or probe). */
    difficulty?: number
}

const isGfy5 = (res: NenrollResponse): res is NenrollFailure => {
    return res.res === "GFY" && res.code === 5
}

export const newNenrollEvent = (content: string, fromPub: string, toPub: string): UnsignedEvent => ({
    content,
    created_at: Math.floor(Date.now() / 1000),
    kind: CLINK_ENROLL_KIND,
    pubkey: fromPub,
    tags: [["p", toPub], ["clink_version", CLINK_VERSION]],
})

const sendEnrollOnce = (
    pool: AbstractSimplePool,
    privateKey: Uint8Array,
    relays: string[],
    toPubKey: string,
    bits: number,
    timeoutSeconds?: number,
): Promise<NenrollResponse> => {
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify({}), getConversationKey(privateKey, toPubKey))
    let event = newNenrollEvent(content, publicKey, toPubKey)
    if (bits > 0) {
        event = mineNip13(event, bits)
    }
    return sendRequest(pool, { privateKey, publicKey }, relays, toPubKey, event, CLINK_ENROLL_KIND, timeoutSeconds)
}

export const SendNenrollRequest = async (
    pool: AbstractSimplePool,
    privateKey: Uint8Array,
    relays: string[],
    toPubKey: string,
    difficulty = 0,
    timeoutSeconds?: number,
): Promise<NenrollResponse> => {
    const used = difficulty > 0 ? difficulty : 0
    const first = await sendEnrollOnce(pool, privateKey, relays, toPubKey, used, timeoutSeconds)
    if (!isGfy5(first)) {
        return first
    }
    const required = first.required_difficulty
    if (typeof required !== "number" || !Number.isInteger(required) || required <= used) {
        return first
    }
    return sendEnrollOnce(pool, privateKey, relays, toPubKey, required, timeoutSeconds)
}
