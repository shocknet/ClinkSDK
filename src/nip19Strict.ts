import { nip19 as nostrNip19 } from "nostr-tools"

const PRINTABLE_ASCII = /^[\x21-\x7E]+$/

const decode = ((value: string) => {
    if (!PRINTABLE_ASCII.test(value)) {
        throw new Error("invalid bech32 string")
    }
    return nostrNip19.decode(value)
}) as typeof nostrNip19.decode

export const nip19: typeof nostrNip19 = { ...nostrNip19, decode }
