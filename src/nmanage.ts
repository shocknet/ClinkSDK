import { nip44, getPublicKey, finalizeEvent, UnsignedEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
import { sendRequest } from "./sender.js"
const { getConversationKey, decrypt, encrypt } = nip44

type ErrorDelta = { max_delta_ms: number, actual_delta_ms: number }
type ErrorRange = { min: number, max: number }

export type NmanageSuccess = { res: 'ok', resource: 'offer', details?: OfferData | OfferData[] }
export type NmanageFailure = {
    res: 'GFY', error: string, code: number,
    delta?: ErrorDelta, retry_after?: number, field?: string, range?: ErrorRange
}
export type NmanageResponse = NmanageSuccess | NmanageFailure

export type OfferFields = {
    label: string,
    price_sats: number,
    callback_url: string,
    payer_data: string[]
}

export type OfferData = OfferFields & {
    id: string
    noffer: string
}

export type NmanageCreateOffer = {
    resource: 'offer',
    action: 'create',
    pointer?: string,
    offer: {
        fields: OfferFields
    }
}

const validateResourceAndAction = (data: unknown, expected: { resource: string, action: string }): object => {
    if (typeof data !== 'object' || data === null) throw new Error('data must be an object')
    if (!('resource' in data) || typeof data.resource !== 'string') throw new Error('resource must be a string')
    if (data.resource !== expected.resource) throw new Error('resource type not supported')
    if (!('action' in data) || typeof data.action !== 'string') throw new Error('action must be a string')
    if (data.action !== expected.action) throw new Error('action not supported')
    return data as object
}

export const validateOfferFields = (fields: unknown): OfferFields => {
    if (typeof fields !== 'object' || fields === null) throw new Error('fields must be an object')
    if (!('label' in fields) || typeof fields.label !== 'string') throw new Error('label must be a string')
    if (!('price_sats' in fields) || typeof fields.price_sats !== 'number') throw new Error('price_sats must be a number')
    if (!('callback_url' in fields) || typeof fields.callback_url !== 'string') throw new Error('callback_url must be a string')
    if (!('payer_data' in fields) || !Array.isArray(fields.payer_data)) throw new Error('payer_data must be an array')
    if (fields.payer_data.some(item => typeof item !== 'string')) throw new Error('payer_data must be an array of strings')
    return fields as OfferFields
}

export const validateNmanageCreateOffer = (data: unknown): NmanageCreateOffer => {
    const obj = validateResourceAndAction(data, { resource: 'offer', action: 'create' })
    if ('pointer' in obj && typeof obj.pointer !== 'string') throw new Error('pointer must be a string if present')
    if (!('offer' in obj) || typeof obj.offer !== 'object' || obj.offer === null) throw new Error('offer must be an object')
    if (!('fields' in obj.offer) || typeof obj.offer.fields !== 'object' || obj.offer.fields === null) throw new Error('fields must be an object')
    validateOfferFields(obj.offer.fields)
    return obj as NmanageCreateOffer
}



export type NmanageUpdateOffer = {
    resource: 'offer',
    action: 'update',
    offer: {
        id: string,
        fields: OfferFields
    }
}

export const validateNmanageUpdateOffer = (data: unknown): NmanageUpdateOffer => {
    const obj = validateResourceAndAction(data, { resource: 'offer', action: 'update' })
    if (!('offer' in obj) || typeof obj.offer !== 'object' || obj.offer === null) throw new Error('offer must be an object')
    if (!('id' in obj.offer) || typeof obj.offer.id !== 'string') throw new Error('id must be a string')
    if (!('fields' in obj.offer) || typeof obj.offer.fields !== 'object' || obj.offer.fields === null) throw new Error('fields must be an object')
    validateOfferFields(obj.offer.fields)
    return obj as NmanageUpdateOffer
}

export type NmanageDeleteOffer = {
    resource: 'offer',
    action: 'delete',
    offer: {
        id: string
    }
}

export const validateNmanageDeleteOffer = (data: unknown): NmanageDeleteOffer => {
    const obj = validateResourceAndAction(data, { resource: 'offer', action: 'delete' })
    if (!('offer' in obj) || typeof obj.offer !== 'object' || obj.offer === null) throw new Error('offer must be an object')
    if (!('id' in obj.offer) || typeof obj.offer.id !== 'string') throw new Error('id must be a string')
    return obj as NmanageDeleteOffer
}

export type NmanageGetOffer = {
    resource: 'offer',
    action: 'get',
    offer: {
        id: string
    }
}

export const validateNmanageGetOffer = (data: unknown): NmanageGetOffer => {
    const obj = validateResourceAndAction(data, { resource: 'offer', action: 'get' })
    if (!('offer' in obj) || typeof obj.offer !== 'object' || obj.offer === null) throw new Error('offer must be an object')
    if (!('id' in obj.offer) || typeof obj.offer.id !== 'string') throw new Error('id must be a string')
    return obj as NmanageGetOffer
}

export type NmanageListOffers = {
    resource: 'offer',
    action: 'list',
    pointer?: string,
}

export const validateNmanageListOffers = (data: unknown): NmanageListOffers => {
    const obj = validateResourceAndAction(data, { resource: 'offer', action: 'list' })
    if ('pointer' in obj && typeof obj.pointer !== 'string') throw new Error('pointer must be a string if present')
    return obj as NmanageListOffers
}

export type NmanageRequest = NmanageCreateOffer | NmanageUpdateOffer | NmanageDeleteOffer | NmanageGetOffer | NmanageListOffers


export const validateNmanageRequest = (data: unknown): NmanageRequest => {
    const action = (data as any).action
    switch (action) {
        case 'create':
            return validateNmanageCreateOffer(data)
        case 'update':
            return validateNmanageUpdateOffer(data)
        case 'delete':
            return validateNmanageDeleteOffer(data)
        case 'get':
            return validateNmanageGetOffer(data)
        case 'list':
            return validateNmanageListOffers(data)
        default:
            throw new Error('nmanage request action not supported')
    }
}

export const SendNmanageRequest = async (pool: AbstractSimplePool, privateKey: Uint8Array, relays: string[], toPubKey: string, data: NmanageRequest, timeoutSeconds?: number): Promise<NmanageResponse> => {
    const publicKey = getPublicKey(privateKey)
    const content = encrypt(JSON.stringify(data), getConversationKey(privateKey, toPubKey))
    const event = newNmanageEvent(content, publicKey, toPubKey)
    return sendRequest(pool, { privateKey, publicKey }, relays, toPubKey, event, 21003, timeoutSeconds)
}

export const newNmanageEvent = (content: string, fromPub: string, toPub: string) => ({
    content,
    created_at: Math.floor(Date.now() / 1000),
    kind: 21003,
    pubkey: fromPub,
    tags: [['p', toPub], ['clink_version', '1']]
})

export const newNmanageFilter = (publicKey: string, eventId: string) => ({
    since: Math.floor(Date.now() / 1000) - 1,
    kinds: [21003],
    '#p': [publicKey],
    '#e': [eventId]
})
type CreateOfferData = {
    price_sats?: number,
    callback_url?: string,
    payer_data?: string[]
}
export const newCreateRequest = (label: string, data: CreateOfferData = {}, pointer?: string): NmanageCreateOffer => {
    const offer: OfferFields = {
        label,
        callback_url: data.callback_url || "",
        payer_data: data.payer_data || [],
        price_sats: data.price_sats || 0
    }
    return {
        resource: 'offer',
        action: 'create',
        pointer,
        offer: {
            fields: offer
        }
    }
}

export const newUpdateRequest = (updatedOffer: OfferData): NmanageUpdateOffer => {
    return {
        resource: 'offer',
        action: 'update',
        offer: {
            id: updatedOffer.id,
            fields: {
                label: updatedOffer.label,
                price_sats: updatedOffer.price_sats,
                callback_url: updatedOffer.callback_url,
                payer_data: updatedOffer.payer_data
            }
        }
    }
}

export const newDeleteRequest = (offerId: string): NmanageDeleteOffer => {
    return {
        resource: 'offer',
        action: 'delete',
        offer: {
            id: offerId
        }
    }
}

export const newGetRequest = (offerId: string): NmanageGetOffer => {
    return {
        resource: 'offer',
        action: 'get',
        offer: {
            id: offerId
        }
    }
}

export const newListRequest = (pointer?: string): NmanageListOffers => {
    return {
        resource: 'offer',
        action: 'list',
        pointer
    }
}
