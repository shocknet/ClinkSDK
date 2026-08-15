import { AbstractSimplePool } from "nostr-tools/lib/types/pool"
import { Event, verifyEvent } from "nostr-tools"
import {
    BEACON_FUTURE_SKEW_SECONDS,
    BEACON_STALE_AFTER_SECONDS,
    CLINK_BEACON_D_TAG,
    CLINK_BEACON_KIND,
    CLINK_VERSION,
} from "./constants.js"
import { enrollPowBitsOk } from "./nip13.js"

export type ClinkBeaconFees = { serviceFeeFloor: number, serviceFeeBps: number }

export type ClinkBeaconContent = {
    name?: string
    avatarUrl?: string
    website?: string
    description?: string
    relays?: string[]
    fees?: ClinkBeaconFees
    enroll_difficulty?: number
    supported_kinds?: number[]
}

export type ClinkBeacon = {
    pubkey: string
    created_at: number
    operator?: string
    content: ClinkBeaconContent
}

const asFiniteNumber = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined
    }
    return value
}

const asString = (value: unknown): string | undefined => {
    return typeof value === "string" && value.length > 0 ? value : undefined
}

const asStringList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
        return undefined
    }
    return value
}

const asNumberList = (value: unknown): number[] | undefined => {
    if (!Array.isArray(value) || value.some(item => typeof item !== "number" || !Number.isFinite(item))) {
        return undefined
    }
    return value
}

const parseFees = (value: unknown): ClinkBeaconFees | undefined => {
    if (typeof value !== "object" || value === null) {
        return undefined
    }
    const serviceFeeFloor = asFiniteNumber((value as { serviceFeeFloor?: unknown }).serviceFeeFloor)
    const serviceFeeBps = asFiniteNumber((value as { serviceFeeBps?: unknown }).serviceFeeBps)
    if (serviceFeeFloor === undefined || serviceFeeBps === undefined) {
        return undefined
    }
    return { serviceFeeFloor, serviceFeeBps }
}

export const parseClinkBeaconContent = (raw: unknown): ClinkBeaconContent => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return {}
    }
    const src = raw as Record<string, unknown>
    const content: ClinkBeaconContent = {}
    const name = asString(src.name)
    const avatarUrl = asString(src.avatarUrl)
    const website = asString(src.website)
    const description = asString(src.description)
    const relays = asStringList(src.relays)
    const fees = parseFees(src.fees)
    const enrollDifficulty = asFiniteNumber(src.enroll_difficulty)
    const supportedKinds = asNumberList(src.supported_kinds)
    if (name) content.name = name
    if (avatarUrl) content.avatarUrl = avatarUrl
    if (website) content.website = website
    if (description) content.description = description
    if (relays) content.relays = relays
    if (fees) content.fees = fees
    if (enrollDifficulty !== undefined && Number.isInteger(enrollDifficulty) && enrollDifficulty >= 0) {
        content.enroll_difficulty = enrollDifficulty
    }
    if (supportedKinds) content.supported_kinds = supportedKinds
    return content
}

const dTag = (tags: string[][]): string | undefined => tags.find(t => t[0] === "d")?.[1]
const versionTag = (tags: string[][]): string | undefined => tags.find(t => t[0] === "clink_version")?.[1]
const operatorTag = (tags: string[][]): string | undefined => tags.find(t => t[0] === "operator")?.[1]

export const parseClinkBeaconEvent = (event: Event): ClinkBeacon | null => {
    if (!verifyEvent(event)) {
        return null
    }
    if (event.kind !== CLINK_BEACON_KIND) {
        return null
    }
    if (dTag(event.tags) !== CLINK_BEACON_D_TAG) {
        return null
    }
    if (versionTag(event.tags) !== CLINK_VERSION) {
        return null
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(event.content)
    } catch {
        return null
    }
    const operator = operatorTag(event.tags)
    return {
        pubkey: event.pubkey.toLowerCase(),
        created_at: event.created_at,
        operator: operator ? operator.toLowerCase() : undefined,
        content: parseClinkBeaconContent(parsed),
    }
}

export const beaconIsFresh = (beacon: ClinkBeacon, nowMs = Date.now()): boolean => {
    const ageSeconds = nowMs / 1000 - beacon.created_at
    if (ageSeconds > BEACON_STALE_AFTER_SECONDS) {
        return false
    }
    if (ageSeconds < -BEACON_FUTURE_SKEW_SECONDS) {
        return false
    }
    return true
}

export const enrollDifficultyFromBeacon = (beacon: ClinkBeacon | null, nowMs = Date.now()): number | undefined => {
    if (!beacon || !beaconIsFresh(beacon, nowMs)) {
        return undefined
    }
    const bits = beacon.content.enroll_difficulty
    if (bits === undefined || bits === 0 || !enrollPowBitsOk(bits)) {
        return undefined
    }
    return bits
}

export const FetchClinkBeacon = async (
    pool: AbstractSimplePool,
    relays: string[],
    servicePub: string,
    timeoutSeconds = 10,
): Promise<ClinkBeacon | null> => {
    const expectedPub = servicePub.toLowerCase()
    return new Promise(resolve => {
        let settled = false
        let best: Event | null = null
        let closer = { close: () => { } }
        const finish = () => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            closer.close()
            resolve(best ? parseClinkBeaconEvent(best) : null)
        }
        const timer = setTimeout(finish, timeoutSeconds * 1000)
        closer = pool.subscribeMany(relays, [{
            kinds: [CLINK_BEACON_KIND],
            authors: [expectedPub],
            "#d": [CLINK_BEACON_D_TAG],
        }], {
            onevent: (event: Event) => {
                if (event.pubkey.toLowerCase() !== expectedPub) {
                    return
                }
                if (!verifyEvent(event)) {
                    return
                }
                if (!best || event.created_at > best.created_at) {
                    best = event
                }
            },
            oneose: finish,
        })
    })
}
