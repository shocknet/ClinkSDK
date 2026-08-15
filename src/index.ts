import { AbstractSimplePool } from "nostr-tools/lib/types/pool"
import { SimplePool, getPublicKey, nip19, generateSecretKey, finalizeEvent, nip44, verifyEvent, type UnsignedEvent } from "nostr-tools"
import { SendNofferRequest, NofferData, NofferReceipt } from "./noffer.js"
import { NdebitData, SendNdebitRequest, generateK1, validateK1, newNdebitBudgetRequest, newNdebitPaymentRequest } from "./ndebit.js"
import { NmanageRequest, SendNmanageRequest, newListRequest } from "./nmanage.js"
import { SendNenrollRequest, NenrollOptions } from "./nenroll.js"
import { FetchClinkBeacon, enrollDifficultyFromBeacon } from "./nbeacon.js"
import { decodeBech32 } from "./nip19Extension.js"
import { setDebug } from "./sender.js"

export type ClinkSettings = {
    privateKey: Uint8Array
    relays: string[]
    toPubKey: string
    defaultTimeoutSeconds?: number
}

const nprofileSettings = (nprofile: string, privateKey: Uint8Array, extra?: Pick<ClinkSettings, "defaultTimeoutSeconds">): ClinkSettings => {
    const decoded = nip19.decode(nprofile)
    if (decoded.type !== "nprofile") {
        throw new Error("expected nprofile")
    }
    const relays = decoded.data.relays || []
    if (relays.length === 0) {
        throw new Error("nprofile has no relays")
    }
    return {
        privateKey,
        relays,
        toPubKey: decoded.data.pubkey,
        defaultTimeoutSeconds: extra?.defaultTimeoutSeconds,
    }
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

    static fromNprofile(nprofile: string, privateKey: Uint8Array, opts?: { defaultTimeoutSeconds?: number, pool?: AbstractSimplePool }) {
        return new ClinkSDK(nprofileSettings(nprofile, privateKey, opts), opts?.pool)
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

    Nbeacon = (timeoutSeconds?: number) => {
        return FetchClinkBeacon(this.pool, this.settings.relays, this.settings.toPubKey, timeoutSeconds || 10)
    }

    Nenroll = async (opts?: NenrollOptions, timeoutSeconds?: number) => {
        const timeout = timeoutSeconds || this.settings.defaultTimeoutSeconds
        const difficulty = opts?.difficulty ?? await this.beaconEnrollDifficulty()
        return SendNenrollRequest(this.pool, this.settings.privateKey, this.settings.relays, this.settings.toPubKey, difficulty, timeout)
    }

    /** Close relay connections. Call when done so the process can exit. */
    Stop = () => {
        this.pool.destroy()
    }

    private beaconEnrollDifficulty = async (): Promise<number> => {
        try {
            const beacon = await this.Nbeacon()
            return enrollDifficultyFromBeacon(beacon) ?? 0
        } catch {
            return 0
        }
    }

    static decodeBech32 = decodeBech32
    static generateSecretKey = generateSecretKey
    static newListRequest = newListRequest
    static newNdebitBudgetRequest = newNdebitBudgetRequest
    static newNdebitPaymentRequest = newNdebitPaymentRequest
    static generateK1 = generateK1
    static validateK1 = validateK1
}

export * from './nip19Extension.js'
export * from './noffer.js'
export * from './nmanage.js'
export * from "./ndebit.js"
export * from "./nenroll.js"
export * from "./nbeacon.js"
export * from "./nip13.js"
export * from "./constants.js"
export { setDebug }
/** Re-exported from the SDK's pinned nostr-tools — import these here, do not install nostr-tools yourself. */
export { SimplePool, getPublicKey, nip19, generateSecretKey, finalizeEvent, nip44, verifyEvent }
export type { AbstractSimplePool, UnsignedEvent }
