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

export type NmanageUpdateOffer = {
    resource: 'offer',
    action: 'update',
    offer: {
        id: string,
        fields: OfferFields
    }
}

export type NmanageDeleteOffer = {
    resource: 'offer',
    action: 'delete',
    offer: {
        id: string
    }
}

export type NmanageGetOffer = {
    resource: 'offer',
    action: 'get',
    offer: {
        id: string
    }
}

export type NmanageListOffers = {
    resource: 'offer',
    action: 'list',
    pointer?: string,
}

export type NmanageRequest = NmanageCreateOffer | NmanageUpdateOffer | NmanageDeleteOffer | NmanageGetOffer | NmanageListOffers

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