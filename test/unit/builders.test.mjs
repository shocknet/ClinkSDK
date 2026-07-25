import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  newNdebitPaymentRequest,
  newNdebitFullAccessRequest,
  newNdebitBudgetRequest,
  newCreateRequest,
  newUpdateRequest,
  newDeleteRequest,
  newGetRequest,
  newListRequest,
} from '../../build/index.js'

describe('request builders', () => {
  it('builds ndebit payment request', () => {
    assert.deepEqual(newNdebitPaymentRequest('lnbc1test', 5000, 'ptr'), {
      bolt11: 'lnbc1test',
      amount_sats: 5000,
      pointer: 'ptr',
    })
  })

  it('builds ndebit payment request with k1', () => {
    const k1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    assert.deepEqual(newNdebitPaymentRequest('lnbc1test', 5000, 'ptr', k1), {
      bolt11: 'lnbc1test',
      amount_sats: 5000,
      pointer: 'ptr',
      k1,
    })
    assert.throws(() => newNdebitPaymentRequest('lnbc1test', 5000, 'ptr', 'not-a-k1'))
  })

  it('builds ndebit full access request', () => {
    assert.deepEqual(newNdebitFullAccessRequest('ptr'), { pointer: 'ptr' })
  })

  it('builds ndebit budget request', () => {
    assert.deepEqual(newNdebitBudgetRequest({ number: 1, unit: 'week' }, 1000, 'ptr'), {
      amount_sats: 1000,
      frequency: { number: 1, unit: 'week' },
      pointer: 'ptr',
    })
  })

  it('builds nmanage helpers', () => {
    assert.deepEqual(newListRequest('ptr'), {
      resource: 'offer',
      action: 'list',
      pointer: 'ptr',
    })
    assert.deepEqual(newGetRequest('offer1'), {
      resource: 'offer',
      action: 'get',
      offer: { id: 'offer1' },
    })
    assert.deepEqual(newDeleteRequest('offer1'), {
      resource: 'offer',
      action: 'delete',
      offer: { id: 'offer1' },
    })
    const created = newCreateRequest('coffee', { price_sats: 21 }, 'ptr')
    assert.equal(created.action, 'create')
    assert.equal(created.offer.fields.label, 'coffee')
    assert.equal(created.offer.fields.price_sats, 21)
    assert.equal(created.pointer, 'ptr')

    const updated = newUpdateRequest({
      id: 'offer1',
      label: 'tea',
      price_sats: 42,
      callback_url: '',
      payer_data: [],
    })
    assert.equal(updated.action, 'update')
    assert.equal(updated.offer.id, 'offer1')
    assert.equal(updated.offer.fields.label, 'tea')
  })
})
