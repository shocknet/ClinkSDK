import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { sendRequest, setDebug } from '../../build/sender.js'
import { signedClinkReply } from './signed-reply.mjs'

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
    subscribeMany(relays, filters, opts) {
      subscribeCalled = true
      order.push('subscribe')
      assert.equal(publishCalled, false, 'subscribe must happen before publish')
      onSubscribe?.(relays, filters, opts)
      onevent = opts.onevent
      return {
        close: () => {
          closed = true
          order.push('close')
        },
      }
    },
    publish(relays, event) {
      publishCalled = true
      order.push('publish')
      assert.equal(subscribeCalled, true, 'publish must happen after subscribe')
      onPublish?.(relays, event)
      const replies = replyFactory?.(event, onevent) ?? []
      for (const reply of replies) {
        queueMicrotask(() => onevent(reply))
      }
      return [Promise.resolve('ok')]
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

const sendOffer = (pool, clientPriv, clientPub, serverPub, timeoutSeconds = 5, moreCb) =>
  sendRequest(
    pool,
    { privateKey: clientPriv, publicKey: clientPub },
    ['wss://relay.example.com'],
    serverPub,
    requestEvent(clientPub, serverPub),
    21001,
    timeoutSeconds,
    moreCb,
  )

describe('sender lifecycle', () => {
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

  it('ignores a signed reply with an unsupported clink_version', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: (request) => [
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'v2' }, 21001, { clinkVersion: '2' }),
        signedClinkReply(serverPriv, clientPub, request.id, { bolt11: 'lnbc1dummy' }, 21001),
      ],
    })

    const result = await sendOffer(pool, clientPriv, clientPub, serverPub)
    assert.deepEqual(result, { bolt11: 'lnbc1dummy' })
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
      /failed to get response in time/
    )
    assert.equal(pool.wasClosed(), true)
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
