import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { sendRequest, setDebug } from '../../build/sender.js'
import { signedClinkReply } from './signed-reply.mjs'
import { SendNofferRequest } from '../../build/index.js'

const { getConversationKey, encrypt } = nip44

async function captureConsole(fn) {
  const lines = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args) => lines.push(args.join(' '))
  console.error = (...args) => lines.push(args.join(' '))
  try {
    await fn()
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  return lines
}

function createMockPool({ onSubscribe, onPublish, replyFactory }) {
  let publishCalled = false
  let subscribeCalled = false
  let closed = false
  let onevent = null
  const order = []

  return {
    order,
    wasClosed: () => closed,
    subscribeCount: () => order.filter(item => item === 'subscribe').length,
    subscribe(relays, filter, opts) {
      if (!subscribeCalled) {
        assert.equal(publishCalled, false, 'subscribe must happen before publish')
      }
      subscribeCalled = true
      closed = false
      order.push('subscribe')
      onevent = opts.onevent
      onSubscribe?.(relays, filter, opts)
      return {
        close: () => {
          closed = true
          order.push('close')
          opts.onclose?.([])
        },
      }
    },
    publish(relays, event) {
      publishCalled = true
      order.push('publish')
      assert.equal(subscribeCalled, true, 'publish must happen after subscribe')
      const attempts = onPublish?.(relays, event)
      const replies = replyFactory?.(event, onevent) ?? []
      for (const reply of replies) {
        queueMicrotask(() => onevent(reply))
      }
      return attempts ?? [Promise.resolve('ok')]
    },
  }
}

const requestEvent = (clientPub, serverPub) => ({
  kind: 21001,
  created_at: Math.floor(Date.now() / 1000),
  tags: [['p', serverPub]],
  content: 'unused',
  pubkey: clientPub,
})

const sendOffer = (pool, clientPriv, clientPub, serverPub, timeoutSeconds = 5, moreCb, relays = ['wss://relay.example.com']) =>
  sendRequest(
    pool,
    { privateKey: clientPriv, publicKey: clientPub },
    relays,
    serverPub,
    requestEvent(clientPub, serverPub),
    21001,
    timeoutSeconds,
    moreCb,
  )

describe('sender lifecycle', () => {
  for (const payload of [
    { code: 1, error: 'Offer unavailable' },
    { code: 6, error: 'Missing payer data', payer_data: ['name', 'quantity'] },
    { code: 6, bolt11: 'lnbc1dummy' },
    { error: 'Invalid invoice', bolt11: 'lnbc1dummy' },
    { bolt11: '' },
    { bolt11: 123 },
    { res: 'ok' },
    {}, [], null, 'invalid',
  ]) {
    it(`closes without receipt polling for primary ${JSON.stringify(payload)}`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
      const intervals = t.mock.method(globalThis, 'setInterval')
      const timeouts = t.mock.method(globalThis, 'setTimeout')
      const clientPriv = generateSecretKey()
      const clientPub = getPublicKey(clientPriv)
      const serverPriv = generateSecretKey()
      const serverPub = getPublicKey(serverPriv)
      const receipt = t.mock.fn()
      let latest
      let requestId
      const pool = createMockPool({
        onSubscribe: (_r, _f, opts) => {
          latest = opts
          opts.onclose([])
        },
        replyFactory: (request) => {
          requestId = request.id
          return [signedClinkReply(serverPriv, clientPub, request.id, payload, 21001)]
        },
      })

      assert.deepEqual(await sendOffer(pool, clientPriv, clientPub, serverPub, 5, receipt), payload)
      assert.equal(pool.wasClosed(), true)
      assert.equal(intervals.mock.callCount(), 0)
      const timeoutCount = timeouts.mock.callCount()
      latest.onclose([])
      await latest.onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok' }, 21001))
      t.mock.timers.tick(12000)
      assert.equal(pool.subscribeCount(), 1)
      assert.equal(timeouts.mock.callCount(), timeoutCount)
      assert.equal(receipt.mock.callCount(), 0)
    })
  }

  it('does not wait for receipts for an invoice-shaped response of another kind', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const intervals = t.mock.method(globalThis, 'setInterval')
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)
    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21002),
      ],
    })

    assert.deepEqual(await sendRequest(pool, { privateKey: clientPriv, publicKey: clientPub },
      ['wss://relay.example.com'], serverPub, requestEvent(clientPub, serverPub), 21002, 5, t.mock.fn()),
    { bolt11: 'lnbc1dummy' })
    assert.equal(pool.wasClosed(), true)
    assert.equal(intervals.mock.callCount(), 0)
    t.mock.timers.tick(12000)
    assert.equal(pool.subscribeCount(), 1)
  })

  it('closes a subscription returned after synchronous response callbacks, even if moreCb throws', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)
    const receipt = t.mock.fn(() => { throw new Error('callback failed') })
    const pool = createMockPool({
      onSubscribe: (_r, filter, opts) => {
        opts.onevent(signedClinkReply(serverPriv, clientPub, filter['#e'][0], { bolt11: 'lnbc1dummy' }, 21001))
        opts.onevent(signedClinkReply(serverPriv, clientPub, filter['#e'][0], { res: 'ok' }, 21001))
        opts.onevent(signedClinkReply(serverPriv, clientPub, filter['#e'][0], { res: 'ok' }, 21001))
      },
    })

    assert.deepEqual(await sendOffer(pool, clientPriv, clientPub, serverPub, 5, receipt), { bolt11: 'lnbc1dummy' })
    assert.equal(receipt.mock.callCount(), 1)
    assert.equal(pool.wasClosed(), true)
    t.mock.timers.tick(12000)
    assert.equal(pool.subscribeCount(), 1)
  })

  it('periodically resubscribes, ignores stale callbacks, and cleans up after receipt callback errors', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)
    const subscriptions = []
    let requestId
    const receipt = t.mock.fn(() => { throw new Error('callback failed') })
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => subscriptions.push(opts),
      replyFactory: (request) => {
        requestId = request.id
        return [signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)]
      },
    })

    await sendOffer(pool, clientPriv, clientPub, serverPub, 5, receipt)
    t.mock.timers.tick(4000)
    assert.equal(pool.subscribeCount(), 2)
    const reply = signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok' }, 21001)
    subscriptions[0].onclose([])
    await subscriptions[0].onevent(reply)
    assert.equal(receipt.mock.callCount(), 0)
    t.mock.timers.tick(500)
    assert.equal(pool.subscribeCount(), 2)
    await subscriptions[1].onevent(reply)
    assert.equal(receipt.mock.callCount(), 1)
    assert.equal(pool.wasClosed(), true)
    await subscriptions[1].onevent(reply)
    t.mock.timers.tick(12000)
    assert.equal(receipt.mock.callCount(), 1)
    assert.equal(pool.subscribeCount(), 2)
  })

  it('preserves code 6 payer-data discovery and sends numeric quantity on explicit retry', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)
    const discovery = {
      code: 6, error: 'Missing payer data', payer_data: ['name', 'quantity'],
      range: { min: 1, max: 1000 }, latest: 'noffer1updated',
    }
    const payloads = []
    const pool = createMockPool({
      replyFactory: (event) => {
        payloads.push(JSON.parse(nip44.decrypt(event.content, getConversationKey(serverPriv, clientPub))))
        const response = payloads.length === 1 ? discovery : { bolt11: 'lnbc1dummy' }
        return [signedClinkReply(serverPriv, clientPub, event.id, response, 21001)]
      },
    })
    const request = {
      offer: 'o', amount_sats: 21, description: 'x'.repeat(100),
      zap: undefined, expires_in_seconds: undefined, payer_data: undefined,
    }

    const receipt = t.mock.fn()
    const response = await SendNofferRequest(pool, clientPriv, ['wss://relay.example.com'], serverPub, request, 5, receipt)
    assert.deepEqual(response, discovery)
    assert.deepEqual(payloads, [{ offer: 'o', amount_sats: 21, description: request.description }])
    assert.equal(pool.wasClosed(), true)
    t.mock.timers.tick(12000)
    assert.equal(pool.subscribeCount(), 1)
    assert.equal(receipt.mock.callCount(), 0)

    const retry = await SendNofferRequest(pool, clientPriv, ['wss://relay.example.com'], serverPub, {
      ...request, payer_data: { name: 'Alice', quantity: 2, email: undefined },
    }, 5)
    assert.deepEqual(retry, { bolt11: 'lnbc1dummy' })
    assert.deepEqual(payloads[1], {
      offer: 'o', amount_sats: 21, description: request.description,
      payer_data: { name: 'Alice', quantity: 2 },
    })
    assert.equal(pool.wasClosed(), true)
  })

  it('subscribes before publish and resolves primary response', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001),
      ],
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub)

    assert.deepEqual(result, { bolt11: 'lnbc1dummy' })
    assert.deepEqual(pool.order.slice(0, 2), ['subscribe', 'publish'])
    assert.equal(pool.wasClosed(), true)
  })

  it('keeps subscription open for moreCb until second event', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    let onevent = null
    let requestId = null
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => {
        onevent = opts.onevent
      },
      replyFactory: (request) => {
        requestId = request.id
        return [signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)]
      },
    })

    let receipt = null
    const primary = await sendOffer(pool, clientPriv, clientPub, serverPub, 5, (data) => {
      receipt = data
    })

    assert.deepEqual(primary, { bolt11: 'lnbc1dummy' })
    assert.equal(pool.wasClosed(), false)

    await onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok' }, 21001))

    assert.deepEqual(receipt, { res: 'ok' })
    assert.equal(pool.wasClosed(), true)
  })

  it('resubscribes after close and still delivers the receipt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    let latest = { onevent: null, onclose: null }
    let requestId = null
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => {
        latest = opts
      },
      replyFactory: (request) => {
        requestId = request.id
        return [signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)]
      },
    })

    let receipt = null
    await sendOffer(pool, clientPriv, clientPub, serverPub, 5, (data) => {
      receipt = data
    })

    assert.equal(pool.subscribeCount(), 1)
    latest.onclose(['closed'])
    t.mock.timers.tick(500)
    assert.ok(pool.subscribeCount() >= 2)

    await latest.onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok' }, 21001))

    assert.deepEqual(receipt, { res: 'ok' })
    assert.equal(pool.wasClosed(), true)
  })

  it('ignores a replayed invoice after resubscribe and still delivers the receipt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    let latest = { onevent: null, onclose: null }
    let requestId = null
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => {
        latest = opts
      },
      replyFactory: (request) => {
        requestId = request.id
        return [signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)]
      },
    })

    let receipt = null
    await sendOffer(pool, clientPriv, clientPub, serverPub, 5, (data) => {
      receipt = data
    })

    latest.onclose(['closed'])
    t.mock.timers.tick(500)
    await latest.onevent(signedClinkReply(serverPriv, clientPub, requestId, { bolt11: 'lnbc1dummy' }, 21001))

    assert.equal(receipt, null)
    assert.equal(pool.wasClosed(), false)

    await latest.onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok' }, 21001))

    assert.deepEqual(receipt, { res: 'ok' })
    assert.equal(pool.wasClosed(), true)
  })

  it('delivers a lightning receipt with preimage', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)
    const preimage = 'ab'.repeat(32)

    let onevent = null
    let requestId = null
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => {
        onevent = opts.onevent
      },
      replyFactory: (request) => {
        requestId = request.id
        return [signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)]
      },
    })

    let receipt = null
    await sendOffer(pool, clientPriv, clientPub, serverPub, 5, (data) => {
      receipt = data
    })

    await onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok', preimage }, 21001))

    assert.deepEqual(receipt, { res: 'ok', preimage })
    assert.equal(pool.wasClosed(), true)
  })

  it('ignores a malformed preimage and still waits for a real receipt', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    let onevent = null
    let requestId = null
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => {
        onevent = opts.onevent
      },
      replyFactory: (request) => {
        requestId = request.id
        return [signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)]
      },
    })

    let receipt = null
    await sendOffer(pool, clientPriv, clientPub, serverPub, 5, (data) => {
      receipt = data
    })

    await onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok', preimage: 'nope' }, 21001))

    assert.equal(receipt, null)
    assert.equal(pool.wasClosed(), false)

    await onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok' }, 21001))

    assert.deepEqual(receipt, { res: 'ok' })
    assert.equal(pool.wasClosed(), true)
  })

  it('does not treat a non-ok res payload as a receipt', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    let onevent = null
    let requestId = null
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => {
        onevent = opts.onevent
      },
      replyFactory: (request) => {
        requestId = request.id
        return [signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)]
      },
    })

    let receipt = null
    await sendOffer(pool, clientPriv, clientPub, serverPub, 5, (data) => {
      receipt = data
    })

    await onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'GFY', error: 'no' }, 21001))

    assert.equal(receipt, null)
    assert.equal(pool.wasClosed(), false)

    await onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok' }, 21001))

    assert.deepEqual(receipt, { res: 'ok' })
    assert.equal(pool.wasClosed(), true)
  })

  it('rejects on decrypt failure from a verified peer reply', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)
    const otherPriv = generateSecretKey()

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'nope' }, 21001, {
          content: encrypt(JSON.stringify({ bolt11: 'nope' }), getConversationKey(otherPriv, clientPub)),
        }),
      ],
    })

    await assert.rejects(
      () => sendOffer(pool, clientPriv, clientPub, serverPub),
      /./
    )
    assert.equal(pool.wasClosed(), true)
  })

  it('ignores forged non-peer events and still resolves the real reply', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)
    const attackerPriv = generateSecretKey()
    const attackerPub = getPublicKey(attackerPriv)

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(attackerPriv, clientPub, request.id, { bolt11: 'stolen' }, 21001),
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001),
      ],
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub)

    assert.deepEqual(result, { bolt11: 'lnbc1dummy' })
    assert.equal(pool.wasClosed(), true)
  })

  it('ignores an unsigned spoof that copies a real ciphertext', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: (request) => {
        const real = signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)
        const spoof = {
          kind: real.kind,
          pubkey: real.pubkey,
          created_at: real.created_at,
          tags: real.tags,
          content: encrypt(JSON.stringify({ bolt11: 'stolen' }), getConversationKey(serverPriv, clientPub)),
          id: '11'.repeat(32),
          sig: '11'.repeat(64),
        }
        return [spoof, real]
      },
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub)
    assert.deepEqual(result, { bolt11: 'lnbc1dummy' })
  })

  it('ignores a signed reply tagged to a different request', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, '00'.repeat(32), { bolt11: 'replay' }, 21001),
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001),
      ],
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub)
    assert.deepEqual(result, { bolt11: 'lnbc1dummy' })
  })

  it('accepts a signed reply with no clink_version', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1legacy' }, 21001, { omitClinkVersion: true }),
      ],
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub)
    assert.deepEqual(result, { bolt11: 'lnbc1legacy' })
  })

  it('ignores a signed reply with explicit unsupported clink_version', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'v2' }, 21001, { clinkVersion: '2' }),
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1v1' }, 21001),
      ],
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub)
    assert.deepEqual(result, { bolt11: 'lnbc1v1' })
  })

  it('ignores a signed reply with mixed clink_version tags', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'mixed' }, 21001, { extraTags: [['clink_version', '2']] }),
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1v1' }, 21001),
      ],
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub)
    assert.deepEqual(result, { bolt11: 'lnbc1v1' })
  })

  it('matches peer pubkey case-insensitively', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001),
      ],
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub.toUpperCase())
    assert.deepEqual(result, { bolt11: 'lnbc1dummy' })
    assert.equal(pool.wasClosed(), true)
  })

  it('rejects on timeout', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPub = getPublicKey(generateSecretKey())

    const pool = createMockPool({
      replyFactory: () => [],
    })

    await assert.rejects(
      () => sendOffer(pool, clientPriv, clientPub, serverPub, 0.05),
      (err) => err instanceof Error && err.message === 'failed to get response in time'
    )
    assert.equal(pool.wasClosed(), true)
  })
})

describe('relay publication', () => {
  const clientPriv = generateSecretKey()
  const clientPub = getPublicKey(clientPriv)
  const serverPriv = generateSecretKey()
  const serverPub = getPublicKey(serverPriv)
  const relays = ['wss://failed.example.com', 'wss://working.example.com']

  for (const failedIndex of [0, 1]) {
    it(`waits for a delayed reply despite relay ${failedIndex} rejecting publication`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
      const pool = createMockPool({
        onPublish: (urls) => {
          assert.deepEqual(urls, relays)
          return urls.map((_, index) => index === failedIndex
            ? Promise.reject(new Error('relay refused')) : Promise.resolve('ok'))
        },
        replyFactory: (request, onevent) => {
          setTimeout(() => onevent(signedClinkReply(serverPriv, clientPub, request.id,
            { bolt11: 'lnbc1dummy' }, 21001)), 50)
        },
      })
      const response = sendOffer(pool, clientPriv, clientPub, serverPub, 5, undefined, relays)
      const checked = assert.doesNotReject(async () => {
        assert.deepEqual(await response, { bolt11: 'lnbc1dummy' })
      })
      await Promise.resolve()
      assert.equal(pool.wasClosed(), false)
      t.mock.timers.tick(50)
      await checked
      assert.equal(pool.wasClosed(), true)
      t.mock.timers.tick(12000)
      assert.equal(pool.subscribeCount(), 1)
    })
  }

  it('rejects and cleans up only after every publish attempt fails', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const lastError = new Error('last relay refused')
    let latest
    const receipt = t.mock.fn()
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => { latest = opts },
      onPublish: () => [
        Promise.reject(new Error('first relay refused')),
        new Promise((_res, rej) => setTimeout(() => rej(lastError), 50)),
      ],
    })
    const rejected = assert.rejects(
      sendOffer(pool, clientPriv, clientPub, serverPub, 5, receipt, relays),
      (error) => error === lastError,
    )
    await Promise.resolve()
    assert.equal(pool.wasClosed(), false)
    t.mock.timers.tick(50)
    await rejected
    assert.equal(pool.wasClosed(), true)
    latest.onclose([])
    t.mock.timers.tick(12000)
    assert.equal(pool.subscribeCount(), 1)
    assert.equal(receipt.mock.callCount(), 0)
  })

  it('preserves an accepted invoice and receipt waiting when all publish rejections arrive late', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    let latest
    let requestId
    const receipt = t.mock.fn()
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => { latest = opts },
      onPublish: () => relays.map(() => new Promise((_res, rej) => {
        setTimeout(() => rej(new Error('late rejection')), 50)
      })),
      replyFactory: (request) => {
        requestId = request.id
        return [signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001)]
      },
    })

    assert.deepEqual(await sendOffer(pool, clientPriv, clientPub, serverPub, 5, receipt, relays),
      { bolt11: 'lnbc1dummy' })
    t.mock.timers.tick(50)
    await Promise.resolve()
    assert.equal(pool.wasClosed(), false)
    t.mock.timers.tick(4000)
    assert.equal(pool.subscribeCount(), 2)
    await latest.onevent(signedClinkReply(serverPriv, clientPub, requestId, { res: 'ok' }, 21001))
    assert.equal(receipt.mock.callCount(), 1)
    assert.equal(pool.wasClosed(), true)
    t.mock.timers.tick(12000)
    assert.equal(pool.subscribeCount(), 2)
  })

  for (const [name, onPublish, message] of [
    ['synchronous publish throws', () => { throw new Error('publish threw') }, /publish threw/],
    ['empty publish results', () => [], /no publish attempts returned/],
  ]) {
    it(`rejects and cleans up on ${name}`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
      let latest
      const pool = createMockPool({
        onSubscribe: (_r, _f, opts) => { latest = opts },
        onPublish,
      })

      await assert.rejects(sendOffer(pool, clientPriv, clientPub, serverPub, 5, t.mock.fn(), relays), message)
      assert.equal(pool.wasClosed(), true)
      latest.onclose([])
      t.mock.timers.tick(12000)
      assert.equal(pool.subscribeCount(), 1)
    })
  }

  it('rejects empty relays without subscribing, publishing, or starting timers', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const timeouts = t.mock.method(globalThis, 'setTimeout')
    const intervals = t.mock.method(globalThis, 'setInterval')
    const pool = createMockPool({})

    await assert.rejects(sendOffer(pool, clientPriv, clientPub, serverPub, 5, t.mock.fn(), []), /no relays provided/)
    assert.deepEqual(pool.order, [])
    assert.equal(timeouts.mock.callCount(), 0)
    assert.equal(intervals.mock.callCount(), 0)
  })
})

describe('debug logging', () => {
  const clientPriv = generateSecretKey()
  const clientPub = getPublicKey(clientPriv)
  const serverPub = getPublicKey(generateSecretKey())

  const sendAndTimeout = () =>
    sendOffer(
      createMockPool({ replyFactory: () => [] }),
      clientPriv,
      clientPub,
      serverPub,
      0.05,
    ).catch(() => {})

  it('is silent by default', async () => {
    const lines = await captureConsole(sendAndTimeout)
    assert.deepEqual(lines, [])
  })

  it('logs lifecycle when enabled, and stops when disabled again', async () => {
    setDebug(true)
    const loud = await captureConsole(sendAndTimeout)
    setDebug(false)
    const quiet = await captureConsole(sendAndTimeout)

    assert.ok(
      loud.some((line) => line.includes('[ClinkSDK]')),
      'expected ClinkSDK lifecycle logs when debug enabled'
    )
    assert.deepEqual(quiet, [])
  })
})
