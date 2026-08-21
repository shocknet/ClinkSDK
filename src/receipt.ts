export type NofferReceipt = { res: 'ok', preimage?: string }

const PREIMAGE_HEX = /^[0-9a-f]{64}$/

export const isNofferReceipt = (parsed: unknown): parsed is NofferReceipt => {
    if (typeof parsed !== 'object' || parsed === null) {
        return false
    }
    const obj = parsed as { res?: unknown, preimage?: unknown }
    if (obj.res !== 'ok') {
        return false
    }
    if (!('preimage' in obj)) {
        return true
    }
    return typeof obj.preimage === 'string' && PREIMAGE_HEX.test(obj.preimage)
}
