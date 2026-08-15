import { nip13, type UnsignedEvent } from "nostr-tools"

export const countLeadingZeroBits = nip13.getPow

export const mineNip13 = (event: UnsignedEvent, bits: number): UnsignedEvent => {
    if (bits <= 0) {
        return event
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
