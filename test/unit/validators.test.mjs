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
  getPublicKey,
  nip44,
  newNdebitFullAccessRequest,
  newNdebitPaymentRequest,
  newNdebitBudgetRequest,
} from '../../build/index.js'
import { signedClinkReply } from './signed-reply.mjs'

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
      assert.deepEqual(validateNofferData(data), data)
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
    assert.deepEqual(validateNofferData(data), { offer: 'o' })
    assert.equal(JSON.stringify(data), '{"offer":"o"}')
    const withPayerData = { ...data, payer_data: { quantity: undefined, name: undefined } }
    assert.deepEqual(validateNofferData(withPayerData), { offer: 'o', payer_data: {} })
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
      [{ offer: 'o', amount_sats: '21' }, /amount_sats must be a positive safe integer/],
      [{ offer: 'o', zap: null }, /zap must be a string/],
      [{ offer: 'o', expires_in_seconds: '60' }, /expires_in_seconds must be a non-negative safe integer/],
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

  it('requires safe integer offer amounts and expiries before sending', async () => {
    for (const value of [NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '21']) {
      for (const field of ['amount_sats', 'expires_in_seconds']) {
        const data = { offer: 'o', [field]: value }
        assert.throws(() => validateNofferData(data), /safe integer/)
        await assert.rejects(SendNofferRequest({}, new Uint8Array(), [], 'invalid', data), /safe integer/)
      }
    }
    assert.throws(() => validateNofferData({ offer: 'o', amount_sats: 0 }), /positive safe integer/)
    assert.deepEqual(validateNofferData({ offer: 'o', amount_sats: Number.MAX_SAFE_INTEGER, expires_in_seconds: 0 }), {
      offer: 'o', amount_sats: Number.MAX_SAFE_INTEGER, expires_in_seconds: 0,
    })
    assert.doesNotThrow(() => validateNofferData({ offer: 'o', expires_in_seconds: Number.MAX_SAFE_INTEGER }))
    assert.throws(() => validateNofferData({ offer: '' }), /offer must not be empty/)
    assert.throws(() => validateNofferData({ offer: 'o', description: 'x'.repeat(101) }), /Description/)
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

describe('request serialization', () => {
  const captureRequest = async (send, data) => {
    const clientKey = generateSecretKey()
    const serverKey = generateSecretKey()
    const clientPub = getPublicKey(clientKey)
    const serverPub = getPublicKey(serverKey)
    let payload
    let deliver
    const pool = {
      subscribe(_relays, _filter, handlers) {
        deliver = handlers.onevent
        return { close() {} }
      },
      publish(_relays, event) {
        payload = JSON.parse(nip44.decrypt(event.content, nip44.getConversationKey(serverKey, clientPub)))
        queueMicrotask(() => deliver(signedClinkReply(serverKey, clientPub, event.id, { res: 'ok' }, event.kind)))
        return [Promise.resolve('ok')]
      },
    }
    await send(pool, clientKey, ['wss://relay.example'], serverPub, data, 1)
    return payload
  }

  it('detaches validated offer and debit data from later caller mutations', () => {
    const offer = { offer: 'o', payer_data: { quantity: 2, name: 'Alice' } }
    const offerPayload = validateNofferData(offer)
    offer.offer = 'changed'
    offer.payer_data.quantity = 100
    assert.deepEqual(offerPayload, { offer: 'o', payer_data: { quantity: 2, name: 'Alice' } })
    const debit = { amount_sats: 21, frequency: { number: 1, unit: 'day' } }
    const debitPayload = validateNdebitData(debit)
    debit.frequency.number = -1
    debit.frequency.unit = 'year'
    assert.deepEqual(debitPayload, { amount_sats: 21, frequency: { number: 1, unit: 'day' } })
  })

  it('does not invoke top-level or inherited payer-data serializers', async () => {
    let serializations = 0
    const payer_data = Object.assign(Object.create({
      toJSON() { serializations++; return { quantity: '2', name: 42 } },
    }), { quantity: 2, name: 'Alice' })
    const data = {
      offer: 'o', amount_sats: 21, payer_data,
      toJSON() { serializations++; return { offer: 'changed', amount_sats: 1, payer_data: null } },
    }
    assert.deepEqual(await captureRequest(SendNofferRequest, data), {
      offer: 'o', amount_sats: 21, payer_data: { quantity: 2, name: 'Alice' },
    })
    assert.equal(serializations, 0)
  })

  it('does not invoke debit frequency serializers or drop recurring budgets', async () => {
    for (const replacement of [{ number: -1, unit: 'year' }, undefined]) {
      let serializations = 0
      const frequency = Object.assign(Object.create({ toJSON() { serializations++; return replacement } }), { number: 1, unit: 'day' })
      const data = { pointer: 'p', amount_sats: 21, frequency, toJSON() { throw new Error('must not serialize caller') } }
      assert.deepEqual(await captureRequest(SendNdebitRequest, data), {
        pointer: 'p', amount_sats: 21, frequency: { number: 1, unit: 'day' },
      })
      assert.equal(serializations, 0)
    }
  })

  it('reads offer scalars and payer-data getters only once before signing', async () => {
    const reads = { offer: 0, amount: 0, payerData: 0, quantity: 0, expiry: 0, description: 0 }
    const data = {
      get offer() { return ++reads.offer === 1 ? 'o' : 'changed' },
      get amount_sats() { return ++reads.amount === 1 ? 21 : -1 },
      get payer_data() {
        reads.payerData++
        return { get quantity() { return ++reads.quantity === 1 ? 2 : 'bad' } }
      },
      get expires_in_seconds() { return ++reads.expiry === 1 ? 60 : NaN },
      get description() { return ++reads.description === 1 ? 'memo' : 'x'.repeat(101) },
    }
    assert.deepEqual(await captureRequest(SendNofferRequest, data), {
      offer: 'o', amount_sats: 21, payer_data: { quantity: 2 }, expires_in_seconds: 60, description: 'memo',
    })
    assert.deepEqual(Object.values(reads), [1, 1, 1, 1, 1, 1])
  })

  it('reads debit scalars and nested frequency getters only once before signing', async () => {
    const reads = { pointer: 0, amount: 0, frequency: 0, number: 0, unit: 0 }
    const data = {
      get pointer() { return ++reads.pointer === 1 ? 'p' : 'changed' },
      get amount_sats() { return ++reads.amount === 1 ? 21 : -1 },
      get frequency() {
        reads.frequency++
        return {
          get number() { return ++reads.number === 1 ? 1 : -1 },
          get unit() { return ++reads.unit === 1 ? 'day' : 'year' },
        }
      },
    }
    assert.deepEqual(await captureRequest(SendNdebitRequest, data), { pointer: 'p', amount_sats: 21, frequency: { number: 1, unit: 'day' } })
    assert.deepEqual(Object.values(reads), [1, 1, 1, 1, 1])
  })

  it('materializes inherited/non-enumerable fields and treats payer data as a map, not a serialized value', async () => {
    const inherited = Object.create({ offer: 'inherited' })
    assert.deepEqual(await captureRequest(SendNofferRequest, inherited), { offer: 'inherited' })
    const nonEnumerable = Object.defineProperty({}, 'offer', { value: 'hidden' })
    assert.deepEqual(await captureRequest(SendNofferRequest, nonEnumerable), { offer: 'hidden' })
    assert.deepEqual(await captureRequest(SendNofferRequest, { offer: 'o', payer_data: new Date(0) }), { offer: 'o', payer_data: {} })
    const payer_data = JSON.parse('{"quantity":2,"__proto__":"opaque","constructor":"opaque"}')
    assert.deepEqual(await captureRequest(SendNofferRequest, { offer: 'o', payer_data }), { offer: 'o', payer_data })
  })
})
