import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { SimplePool } from "nostr-tools"
import { SendNofferRequest, NofferData } from "./noffer"
import { NdebitData } from "./ndebit"
import { SendNdebitRequest } from "./ndebit"
//pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NofferData, timeoutSeconds = 30

export type CLinkSettings = {
    privateKey: Uint8Array
    relays: string[]
    toPubKey: string
    defaultTimeoutSeconds?: number
}

class CLinkSDK {
    pool: AbstractSimplePool
    settings: CLinkSettings
    constructor(settings: CLinkSettings, pool?: AbstractSimplePool) {
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
}

export default CLinkSDK
export const NofferReq = SendNofferRequest
export const NdebitReq = SendNdebitRequest