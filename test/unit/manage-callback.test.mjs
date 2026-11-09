import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { newCreateRequest, newUpdateRequest, validateNmanageRequest, SendNmanageRequest } from '../../build/index.js'
import { signedClinkReply } from './signed-reply.mjs'

const fields = { label: 'Product', price_sats: 1000, payer_data: [] }
const request = (action, data) => action === 'create'
  ? { resource: 'offer', action, pointer: 'seller', offer: { fields: data } }
  : { resource: 'offer', action, offer: { id: 'offer-id', fields: data } }

describe('optional Manage callbacks', () => {
  it('accepts omitted, null, empty, and string callbacks on create and update', () => {
    for (const action of ['create', 'update']) {
      for (const data of [fields, ...[undefined, null, '', 'https://example.com/hook'].map(callback_url => ({ ...fields, callback_url }))]) {
        const dataRequest = request(action, data)
        assert.deepEqual(validateNmanageRequest(dataRequest), dataRequest)
      }
    }
  })

  it('rejects other callback types without making the other fields optional', () => {
    for (const action of ['create', 'update']) {
      for (const callback_url of [0, 1, true, false, [], {}]) {
        assert.throws(() => validateNmanageRequest(request(action, { ...fields, callback_url })), /callback_url/)
      }
      for (const field of ['label', 'price_sats', 'payer_data']) {
        const partial = { ...fields }
        delete partial[field]
        assert.throws(() => validateNmanageRequest(request(action, partial)), new RegExp(field))
      }
    }
    assert.throws(() => validateNmanageRequest({
      resource: 'offer', action: 'update', pointer: 'seller', offer: { fields },
    }), /id must be a string/)
  })

  it('builders preserve omission versus explicit clearing and never default a label', () => {
    const created = newCreateRequest('Product', {}, 'seller')
    assert.deepEqual(created.offer.fields, { label: 'Product', price_sats: 0, payer_data: [] })
    const updated = newUpdateRequest({ id: 'offer-id', noffer: 'noffer1test', ...fields })
    assert.equal(Object.hasOwn(updated.offer.fields, 'callback_url'), false)
    for (const callback_url of [null, '', 'https://example.com/hook']) {
      assert.equal(newCreateRequest('Product', { callback_url }, 'seller').offer.fields.callback_url, callback_url)
      assert.equal(newUpdateRequest({ id: 'offer-id', noffer: 'noffer1test', ...fields, callback_url }).offer.fields.callback_url, callback_url)
    }
    assert.throws(() => validateNmanageRequest(newCreateRequest(undefined, {}, 'seller')), /label/)
  })

  it('sends omission and null distinctly and preserves null in a server response', async () => {
    const clientKey = generateSecretKey()
    const serverKey = generateSecretKey()
    const clientPub = getPublicKey(clientKey)
    const serverPub = getPublicKey(serverKey)
    const conversation = nip44.getConversationKey(serverKey, clientPub)
    let deliver
    let sent
    const pool = {
      subscribe(_relays, _filter, handlers) {
        deliver = handlers.onevent
        return { close() {} }
      },
      publish(_relays, event) {
        sent = JSON.parse(nip44.decrypt(event.content, conversation))
        queueMicrotask(() => deliver(signedClinkReply(serverKey, clientPub, event.id, {
          res: 'ok', resource: 'offer', details: { id: 'offer-id', noffer: 'noffer1test', ...fields, callback_url: null },
        }, 21003)))
        return [Promise.resolve('ok')]
      },
    }
    for (const action of ['create', 'update']) {
      for (const data of [fields, { ...fields, callback_url: null }, { ...fields, callback_url: '' }]) {
        const input = request(action, data)
        const response = await SendNmanageRequest(pool, clientKey, ['wss://relay.example'], serverPub, input, 1)
        assert.deepEqual(sent, input)
        assert.equal(response.details.callback_url, null)
      }
    }
  })
})
