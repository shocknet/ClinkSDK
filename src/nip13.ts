import { nip13, type UnsignedEvent } from "nostr-tools"
import { MAX_ENROLL_POW_BITS } from "./constants.js"

export const countLeadingZeroBits = nip13.getPow

export const enrollPowBitsOk = (bits: number): boolean => {
    return Number.isInteger(bits) && bits >= 0 && bits <= MAX_ENROLL_POW_BITS
}

export const mineNip13 = (event: UnsignedEvent, bits: number): UnsignedEvent => {
    if (bits <= 0) {
        return event
    }
    if (!enrollPowBitsOk(bits)) {
        throw new Error(`enroll PoW difficulty ${bits} exceeds max ${MAX_ENROLL_POW_BITS}`)
    }
    const unsigned: UnsignedEvent = {
        ...event,
        tags: event.tags.filter(t => t[0] !== "nonce"),
    }
    const mined = nip13.minePow(unsigned, bits)
    return {
        content: mined.content,
        created_at: mined.created_at,
        kind: mined.kind,
        pubkey: mined.pubkey,
        tags: mined.tags,
    }
}
