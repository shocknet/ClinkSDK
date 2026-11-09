import type { OfferFields, OfferData, NmanageCreateOffer, NmanageUpdateOffer } from '../../build/index.js'
import { newCreateRequest, newUpdateRequest } from '../../build/index.js'

const fields: OfferFields = { label: 'Product', price_sats: 1000, payer_data: [] }
const create: NmanageCreateOffer = { resource: 'offer', action: 'create', pointer: 'seller', offer: { fields } }
const update: NmanageUpdateOffer = { resource: 'offer', action: 'update', offer: { id: 'offer-id', fields } }
const data: OfferData = { id: 'offer-id', noffer: 'noffer1test', ...fields, callback_url: null }
newCreateRequest('Product', { callback_url: null }, 'seller')
newUpdateRequest(data)

// @ts-expect-error Label remains required.
const missingLabel: OfferFields = { price_sats: 1000, payer_data: [] }
// @ts-expect-error Callback must be a string, null, or omitted.
const invalidCallback: OfferFields = { ...fields, callback_url: 123 }
// @ts-expect-error Update must identify a specific offer.
const missingId: NmanageUpdateOffer = { resource: 'offer', action: 'update', offer: { fields } }
