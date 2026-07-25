import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { SimplePool, getPublicKey, nip19, generateSecretKey, finalizeEvent, nip44, verifyEvent, type UnsignedEvent } from "nostr-tools"
import { SendNofferRequest, NofferData, NofferReceipt } from "./noffer.js"
import { NdebitData, SendNdebitRequest, generateK1, newNdebitBudgetRequest, newNdebitPaymentRequest } from "./ndebit.js"
import { NmanageRequest, SendNmanageRequest, newListRequest } from "./nmanage.js"
import { decodeBech32 } from "./nip19Extension.js"

//pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NofferData, timeoutSeconds = 30

export type ClinkSettings = {
    privateKey: Uint8Array
    relays: string[]
    toPubKey: string
    defaultTimeoutSeconds?: number
}

export class ClinkSDK {
    pool: AbstractSimplePool
    settings: ClinkSettings
    constructor(settings: ClinkSettings, pool?: AbstractSimplePool) {
        this.settings = settings
        if (pool) {
            this.pool = pool
        } else {
            this.pool = new SimplePool()
        }
    }

    Noffer = (data: NofferData, onReceipt?: (receipt: NofferReceipt) => void, timeoutSeconds?: number) => {
        return SendNofferRequest(this.pool, this.settings.privateKey, this.settings.relays, this.settings.toPubKey, data, timeoutSeconds || this.settings.defaultTimeoutSeconds, onReceipt)
    }

    Ndebit = (data: NdebitData, timeoutSeconds?: number) => {
        return SendNdebitRequest(this.pool, this.settings.privateKey, this.settings.relays, this.settings.toPubKey, data, timeoutSeconds || this.settings.defaultTimeoutSeconds)
    }

    Nmanage = (data: NmanageRequest, timeoutSeconds?: number) => {
        return SendNmanageRequest(this.pool, this.settings.privateKey, this.settings.relays, this.settings.toPubKey, data, timeoutSeconds || this.settings.defaultTimeoutSeconds)
    }

    /** Close relay connections. Call when done so the process can exit. */
    Stop = () => {
        this.pool.destroy()
    }

    static decodeBech32 = decodeBech32
    static generateSecretKey = generateSecretKey
    static newListRequest = newListRequest
    static newNdebitBudgetRequest = newNdebitBudgetRequest
    static newNdebitPaymentRequest = newNdebitPaymentRequest
    static generateK1 = generateK1
}

export * from './nip19Extension.js'
export * from './noffer.js'
export * from './nmanage.js'
export * from "./ndebit.js"
/** Re-exported from the SDK's pinned nostr-tools — import these here, do not install nostr-tools yourself. */
export { SimplePool, getPublicKey, nip19, generateSecretKey, finalizeEvent, nip44, verifyEvent }
export type { AbstractSimplePool, UnsignedEvent }
