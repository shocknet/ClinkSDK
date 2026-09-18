import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateK1,
  generateK1,
  validateBudgetFrequency,
  validateNdebitData,
  validateNofferData,
  validateNmanageRequest,
  validateOfferFields,
  newCreateRequest,
  newListRequest,
  newGetRequest,
  gfy6Reason,
  SendNdebitRequest,
  generateSecretKey,
  newNdebitFullAccessRequest,
  newNdebitPaymentRequest,
  newNdebitBudgetRequest,
} from '../../build/index.js'

describe('validators', () => {
  it('validates k1', () => {
    const k1 = generateK1()
    assert.equal(validateK1(k1), k1)
    assert.throws(() => validateK1(k1.toUpperCase()))
    assert.throws(() => validateK1('short'))
  })

  it('exports gfy6 reason tokens', () => {
    assert.equal(gfy6Reason.k1AlreadyProcessed, 'k1_already_processed')
    assert.equal(gfy6Reason.invoiceInProgress, 'invoice_in_progress')
    assert.equal(gfy6Reason.invoiceAlreadyFailed, 'invoice_already_failed')
    assert.equal(gfy6Reason.invoiceAlreadyPaid, 'invoice_already_paid')
  })

  it('validates budget frequency', () => {
    assert.deepEqual(validateBudgetFrequency({ number: 1, unit: 'week' }), {
      number: 1,
      unit: 'week',
    })
    assert.throws(() => validateBudgetFrequency({ number: 0, unit: 'week' }))
    assert.throws(() => validateBudgetFrequency({ number: 1.5, unit: 'week' }))
    assert.throws(() => validateBudgetFrequency({ number: 1, unit: 'year' }))
  })

  it('validates ndebit data including description and k1', () => {
    const k1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    assert.deepEqual(
      validateNdebitData({ bolt11: 'lnbc1', amount_sats: 21, pointer: 'p', k1, description: 'coffee' }),
      { bolt11: 'lnbc1', amount_sats: 21, pointer: 'p', k1, description: 'coffee' }
    )
    assert.throws(() => validateNdebitData({ bolt11: 1 }))
    assert.throws(() => validateNdebitData({ description: 'x'.repeat(101) }))
    assert.throws(() => validateNdebitData({ k1: 'bad' }))
    assert.throws(() => validateNdebitData({ pointer: 'p', k1 }))
    assert.throws(() => validateNdebitData({
      pointer: 'p',
      k1,
      amount_sats: 500,
      frequency: { number: 1, unit: 'day' },
    }))
    assert.throws(() => validateNdebitData([]))
    assert.throws(() => validateNdebitData({ bolt11: 'lnbc1', amount_sats: 21, frequency: { number: 1, unit: 'day' } }))
    assert.throws(() => validateNdebitData({ frequency: { number: 1, unit: 'day' } }))
    assert.throws(() => validateNdebitData({ bolt11: '' }))
    assert.throws(() => validateNdebitData({ bolt11: 'lnbc1', amount_sats: 0 }))
    assert.throws(() => validateNdebitData({ bolt11: 'lnbc1', amount_sats: -1 }))
    assert.throws(() => validateNdebitData({ bolt11: 'lnbc1', amount_sats: 1.5 }))
    assert.throws(() => validateNdebitData({ bolt11: 'lnbc1', amount_sats: Number.NaN }))
    assert.throws(() => validateNdebitData({ bolt11: 'lnbc1', amount_sats: Number.POSITIVE_INFINITY }))
    assert.throws(() => validateNdebitData({ bolt11: 'lnbc1', amount_sats: Number.MAX_SAFE_INTEGER + 1 }))
    assert.throws(() => newNdebitBudgetRequest({ number: 1, unit: 'day' }, 0))
  })

  it('treats undefined optional fields as omitted', () => {
    assert.deepEqual(validateNdebitData(newNdebitFullAccessRequest()), {})
    assert.deepEqual(validateNdebitData(newNdebitPaymentRequest('lnbc1')), { bolt11: 'lnbc1' })
    assert.deepEqual(
      validateNdebitData(newNdebitBudgetRequest({ number: 1, unit: 'day' }, 500)),
      { amount_sats: 500, frequency: { number: 1, unit: 'day' } },
    )
    assert.deepEqual(validateNdebitData({ pointer: undefined, bolt11: 'lnbc1' }), { bolt11: 'lnbc1' })
  })

  it('SendNdebitRequest validates before sending', async () => {
    const k1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    await assert.rejects(
      SendNdebitRequest({}, generateSecretKey(), [], 'aa'.repeat(32), { pointer: 'p', k1 }),
      /k1 requires a bolt11 payment request/,
    )
  })

  it('validates noffer data', () => {
    assert.deepEqual(validateNofferData({ offer: 'o', amount_sats: 21 }), {
      offer: 'o',
      amount_sats: 21,
    })
    assert.throws(() => validateNofferData({}))
    assert.throws(() => validateNofferData({ offer: 'o', payer_data: [] }))
    assert.doesNotThrow(() =>
      validateNofferData({ offer: 'o', payer_data: { name: 'bob' } })
    )
  })

  it('validates nmanage requests by action', () => {
    const created = newCreateRequest('coffee', { price_sats: 21 }, 'ptr')
    assert.deepEqual(validateNmanageRequest(created), created)
    assert.deepEqual(validateNmanageRequest(newListRequest('ptr')), {
      resource: 'offer',
      action: 'list',
      pointer: 'ptr',
    })
    assert.deepEqual(validateNmanageRequest(newGetRequest('id1')), {
      resource: 'offer',
      action: 'get',
      offer: { id: 'id1' },
    })
    assert.throws(() => validateNmanageRequest({ resource: 'offer', action: 'explode' }))
    assert.throws(() =>
      validateOfferFields({
        label: 'x',
        price_sats: 1,
        callback_url: '',
        payer_data: [1],
      })
    )
  })
})
