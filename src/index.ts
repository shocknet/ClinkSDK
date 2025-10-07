import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { SimplePool, getPublicKey, nip19, generateSecretKey } from "nostr-tools"
import { SendNofferRequest, NofferData, NofferReceipt } from "./noffer.js"
import { NdebitData, SendNdebitRequest, newNdebitBudgetRequest } from "./ndebit.js"
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

    static decodeBech32 = decodeBech32
    static generateSecretKey = generateSecretKey
    static newListRequest = newListRequest
    static newNdebitBudgetRequest = newNdebitBudgetRequest
}

export * from './nip19Extension.js'
export * from './noffer.js'
export * from './nmanage.js'
export * from "./ndebit.js"
export { SimplePool, getPublicKey, nip19, generateSecretKey }
