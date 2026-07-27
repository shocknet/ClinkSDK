import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { sendRequest, setDebug } from '../../build/sender.js'

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

function makeEncryptedReply(serverPriv, clientPub, payload) {
  return encrypt(JSON.stringify(payload), getConversationKey(serverPriv, clientPub))
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

describe('sender lifecycle', () => {
  it('subscribes before publish and resolves primary response', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: () => [
        {
          id: 'reply1',
          kind: 21001,
          pubkey: serverPub,
          content: makeEncryptedReply(serverPriv, clientPub, { bolt11: 'lnbc1dummy' }),
        },
      ],
    })

    const result = await sendRequest(
      pool,
      { privateKey: clientPriv, publicKey: clientPub },
      ['wss://relay.example.com'],
      serverPub,
      {
        kind: 21001,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', serverPub]],
        content: 'unused',
        pubkey: clientPub,
      },
      21001,
      5
    )

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
    const pool = createMockPool({
      onSubscribe: (_r, _f, opts) => {
        onevent = opts.onevent
      },
      replyFactory: () => [
        {
          id: 'primary',
          kind: 21001,
          pubkey: serverPub,
          content: makeEncryptedReply(serverPriv, clientPub, { bolt11: 'lnbc1dummy' }),
        },
      ],
    })

    let receipt = null
    const primary = await sendRequest(
      pool,
      { privateKey: clientPriv, publicKey: clientPub },
      ['wss://relay.example.com'],
      serverPub,
      {
        kind: 21001,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', serverPub]],
        content: 'unused',
        pubkey: clientPub,
      },
      21001,
      5,
      (data) => {
        receipt = data
      }
    )

    assert.deepEqual(primary, { bolt11: 'lnbc1dummy' })
    assert.equal(pool.wasClosed(), false)

    await onevent({
      id: 'receipt',
      kind: 21001,
      pubkey: serverPub,
      content: makeEncryptedReply(serverPriv, clientPub, { res: 'ok' }),
    })

    assert.deepEqual(receipt, { res: 'ok' })
    assert.equal(pool.wasClosed(), true)
  })

  it('rejects on decrypt failure from expected peer', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPub = getPublicKey(generateSecretKey())
    const otherPriv = generateSecretKey()

    const pool = createMockPool({
      replyFactory: () => [
        {
          id: 'bad',
          kind: 21001,
          pubkey: serverPub,
          content: makeEncryptedReply(otherPriv, clientPub, { bolt11: 'nope' }),
        },
      ],
    })

    await assert.rejects(
      () =>
        sendRequest(
          pool,
          { privateKey: clientPriv, publicKey: clientPub },
          ['wss://relay.example.com'],
          serverPub,
          {
            kind: 21001,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', serverPub]],
            content: 'unused',
            pubkey: clientPub,
          },
          21001,
          5
        ),
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
      replyFactory: () => [
        {
          id: 'forged',
          kind: 21001,
          pubkey: attackerPub,
          content: 'not-valid-nip44',
        },
        {
          id: 'reply1',
          kind: 21001,
          pubkey: serverPub,
          content: makeEncryptedReply(serverPriv, clientPub, { bolt11: 'lnbc1dummy' }),
        },
      ],
    })

    const result = await sendRequest(
      pool,
      { privateKey: clientPriv, publicKey: clientPub },
      ['wss://relay.example.com'],
      serverPub,
      {
        kind: 21001,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', serverPub]],
        content: 'unused',
        pubkey: clientPub,
      },
      21001,
      5
    )

    assert.deepEqual(result, { bolt11: 'lnbc1dummy' })
    assert.equal(pool.wasClosed(), true)
  })

  it('matches peer pubkey case-insensitively', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)

    const pool = createMockPool({
      replyFactory: () => [
        {
          id: 'reply1',
          kind: 21001,
          pubkey: serverPub,
          content: makeEncryptedReply(serverPriv, clientPub, { bolt11: 'lnbc1dummy' }),
        },
      ],
    })

    const result = await sendRequest(
      pool,
      { privateKey: clientPriv, publicKey: clientPub },
      ['wss://relay.example.com'],
      serverPub.toUpperCase(),
      {
        kind: 21001,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', serverPub]],
        content: 'unused',
        pubkey: clientPub,
      },
      21001,
      5
    )

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
      () =>
        sendRequest(
          pool,
          { privateKey: clientPriv, publicKey: clientPub },
          ['wss://relay.example.com'],
          serverPub,
          {
            kind: 21001,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', serverPub]],
            content: 'unused',
            pubkey: clientPub,
          },
          21001,
          0.05
        ),
      /failed to get response in time/
    )
    assert.equal(pool.wasClosed(), true)
  })
})

describe('debug logging', () => {
  const clientPriv = generateSecretKey()
  const clientPub = getPublicKey(clientPriv)
  const serverPub = getPublicKey(generateSecretKey())
  const request = {
    kind: 21001,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', serverPub]],
    content: 'unused',
    pubkey: clientPub,
  }

  const sendAndTimeout = () =>
    sendRequest(
      createMockPool({ replyFactory: () => [] }),
      { privateKey: clientPriv, publicKey: clientPub },
      ['wss://relay.example.com'],
      serverPub,
      request,
      21001,
      0.05
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
