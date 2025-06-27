import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { SimplePool, getPublicKey, nip19, generateSecretKey } from "nostr-tools"
import { SendNofferRequest, NofferData } from "./noffer.js"
import { NdebitData } from "./ndebit.js"
import { SendNdebitRequest } from "./ndebit.js"
import { NmanageRequest, SendNmanageRequest } from "./nmanage.js"




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

    Noffer = (data: NofferData, timeoutSeconds?: number) => {
        SendNofferRequest(this.pool, this.settings.privateKey, this.settings.relays, this.settings.toPubKey, data, timeoutSeconds || this.settings.defaultTimeoutSeconds)
    }

    Ndebit = (data: NdebitData, timeoutSeconds?: number) => {
        SendNdebitRequest(this.pool, this.settings.privateKey, this.settings.relays, this.settings.toPubKey, data, timeoutSeconds || this.settings.defaultTimeoutSeconds)
    }

    Nmanage = (data: NmanageRequest, timeoutSeconds?: number) => {
        SendNmanageRequest(this.pool, this.settings.privateKey, this.settings.relays, this.settings.toPubKey, data, timeoutSeconds || this.settings.defaultTimeoutSeconds)
    }
}

export * from './nip19Extension.js'
export * from './noffer.js'
export * from './nmanage.js'
export * from "./ndebit.js"
export { SimplePool, getPublicKey, nip19, generateSecretKey }
