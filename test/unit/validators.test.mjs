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
  SendNofferRequest,
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

  it('accepts numeric noffer quantity and string payer data', () => {
    for (const quantity of [1, 2, Number.MAX_SAFE_INTEGER]) {
      const data = { offer: 'o', payer_data: { quantity, name: 'Alice', Quantity: 'custom', quantity_hint: '2' } }
      assert.equal(validateNofferData(data), data)
    }
    assert.doesNotThrow(() => validateNofferData({ offer: 'o', payer_data: {} }))
  })

  it('rejects invalid noffer quantity', () => {
    for (const quantity of [
      0, -0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1,
      NaN, Infinity, -Infinity, '2', '', null, true, false, {}, [], 2n,
    ]) {
      assert.throws(
        () => validateNofferData({ offer: 'o', payer_data: { quantity } }),
        /payer_data\.quantity must be a positive safe integer/,
      )
    }
  })

  it('rejects invalid noffer payer-data values and containers', () => {
    for (const value of [2, 0, NaN, Infinity, null, true, false, {}, [], 2n, () => {}, Symbol('value')]) {
      for (const key of ['name', 'Quantity', 'quantity_hint']) {
        assert.throws(
          () => validateNofferData({ offer: 'o', payer_data: { [key]: value } }),
          /must be a string/,
        )
      }
    }
    for (const payer_data of [null, [], ['Alice'], 'Alice', 2, true, () => {}]) {
      assert.throws(() => validateNofferData({ offer: 'o', payer_data }), /payer_data must be an object/)
    }
    for (const data of [null, [], Object.assign([], { offer: 'o' }), 'o', 2, undefined]) {
      assert.throws(() => validateNofferData(data), /data must be an object/)
    }
  })

  it('accepts undefined optional noffer fields as omitted', () => {
    const data = {
      offer: 'o', amount_sats: undefined, zap: undefined, payer_data: undefined,
      expires_in_seconds: undefined, description: undefined,
    }
    assert.equal(validateNofferData(data), data)
    assert.equal(JSON.stringify(data), '{"offer":"o"}')
    const withPayerData = { ...data, payer_data: { quantity: undefined, name: undefined } }
    assert.equal(validateNofferData(withPayerData), withPayerData)
    assert.equal(JSON.stringify(withPayerData), '{"offer":"o","payer_data":{}}')
  })

  it('SendNofferRequest validates before encryption or relay contact', async () => {
    let contacted = false
    const pool = {
      subscribe() { contacted = true; throw new Error('unexpected subscribe') },
      publish() { contacted = true; throw new Error('unexpected publish') },
    }
    for (const [data, error] of [
      [{}, /offer must be a string/],
      [{ offer: 1 }, /offer must be a string/],
      [{ offer: 'o', amount_sats: '21' }, /amount_sats must be a number/],
      [{ offer: 'o', zap: null }, /zap must be a string/],
      [{ offer: 'o', expires_in_seconds: '60' }, /expires_in_seconds must be a number/],
      [{ offer: 'o', description: 1 }, /description must be a string/],
      [{ offer: 'o', description: 'x'.repeat(101) }, /Description must be less than 100 characters/],
      [{ offer: 'o', payer_data: [] }, /payer_data must be an object/],
      [{ offer: 'o', payer_data: { name: 2 } }, /payer_data\.name must be a string/],
      [{ offer: 'o', payer_data: { quantity: '2' } }, /payer_data\.quantity must be a positive safe integer/],
      [{ offer: 'o', payer_data: { quantity: 0 } }, /payer_data\.quantity must be a positive safe integer/],
    ]) {
      // Invalid keys ensure validation happens before key derivation and encryption too.
      await assert.rejects(SendNofferRequest(pool, new Uint8Array(), [], 'invalid', data), error)
    }
    assert.equal(contacted, false)
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
