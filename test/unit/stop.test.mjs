import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import {
  ClinkSDK, FetchClinkBeacon, SendNofferRequest, SendNdebitRequest,
  SendNmanageRequest, SendNenrollRequest, CLINK_BEACON_KIND,
} from '../../build/index.js'
import { sendRequest } from '../../build/sender.js'
import { signedClinkReply } from './signed-reply.mjs'

const clientPriv = generateSecretKey()
const clientPub = getPublicKey(clientPriv)
const serverPriv = generateSecretKey()
const serverPub = getPublicKey(serverPriv)
const relays = ['wss://relay.example']
const settings = { privateKey: clientPriv, relays, toPubKey: serverPub }
const aborted = { name: 'AbortError' }

function setup(t, { onSubscribe, onPublish } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const subscriptions = []
  const published = []
  const order = []
  const pool = {
    subscribe(_relays, filter, opts) {
      order.push('subscribe')
      const sub = {
        filter, opts, closed: false,
        close() {
          if (sub.closed) return
          sub.closed = true
          order.push('close')
          opts.onclose?.([])
        },
      }
      subscriptions.push(sub)
      onSubscribe?.(sub)
      return sub
    },
    publish(_relays, event) {
      order.push('publish')
      published.push(event)
      onPublish?.(event, subscriptions.at(-1))
      return [Promise.resolve('ok')]
    },
    destroy() {
      order.push('destroy')
      for (const sub of subscriptions) sub.opts.onclose?.([])
    },
  }
  const sdk = new ClinkSDK(settings, pool)
  return { sdk, pool, subscriptions, published, order }
}

const reply = (sub, payload) => sub.opts.onevent(signedClinkReply(
  serverPriv, clientPub, sub.filter['#e'][0], payload, sub.filter.kinds[0],
))

describe('SDK shutdown', () => {
  it('cancels receipt polling and queued relistens before destroying the pool', async (t) => {
    const { sdk, subscriptions, published, order } = setup(t)
    const receipt = t.mock.fn()
    const primary = sdk.Noffer({ offer: 'o' }, receipt)
    await reply(subscriptions[0], { bolt11: 'lnbc1dummy' })
    assert.deepEqual(await primary, { bolt11: 'lnbc1dummy' })
    t.mock.timers.tick(4000)
    assert.equal(subscriptions.length, 2)
    subscriptions[1].opts.onclose([])
    const clearTimeouts = t.mock.method(globalThis, 'clearTimeout')
    const clearIntervals = t.mock.method(globalThis, 'clearInterval')

    sdk.Stop()
    sdk.Stop()
    assert.equal(clearTimeouts.mock.callCount(), 1)
    assert.equal(clearIntervals.mock.callCount(), 1)
    assert.deepEqual(order.slice(-2), ['close', 'destroy'])
    assert.equal(order.filter(item => item === 'destroy').length, 1)
    const timeouts = t.mock.method(globalThis, 'setTimeout')
    for (const sub of subscriptions) {
      assert.equal(sub.closed, true)
      sub.opts.onclose([])
      await reply(sub, { res: 'ok' })
    }
    t.mock.timers.tick(60000)
    assert.equal(timeouts.mock.callCount(), 0)
    assert.equal(subscriptions.length, 2)
    assert.equal(published.length, 1)
    assert.equal(receipt.mock.callCount(), 0)
  })

  it('rejects all pending primary requests, including requests without timeouts', async (t) => {
    const { sdk, subscriptions, published, order } = setup(t)
    const receipt = t.mock.fn()
    const pending = [
      sdk.Noffer({ offer: 'o' }, receipt), sdk.Ndebit({}),
      sdk.Nmanage({ resource: 'offer', action: 'list' }),
      sdk.Nenroll({ difficulty: 0 }), sdk.Nbeacon(),
    ].map(promise => assert.rejects(promise, aborted))
    assert.equal(subscriptions.length, 5)
    const clearTimeouts = t.mock.method(globalThis, 'clearTimeout')
    sdk.Stop()
    assert.equal(clearTimeouts.mock.callCount(), 2)
    assert.equal(order.at(-1), 'destroy')
    assert.ok(subscriptions.every(sub => sub.closed))
    await Promise.all(pending)
    for (const sub of subscriptions) {
      sub.opts.onclose?.([])
      if (sub.filter.kinds[0] === CLINK_BEACON_KIND) sub.opts.oneose()
      else await reply(sub, { bolt11: 'lnbc1late' })
    }
    t.mock.timers.tick(60000)
    assert.equal(subscriptions.length, 5)
    assert.equal(published.length, 4)
    assert.equal(receipt.mock.callCount(), 0)
  })

  it('rejects every network method after Stop without reconnecting or starting timers', async (t) => {
    const { sdk, order } = setup(t)
    sdk.Stop()
    const timeouts = t.mock.method(globalThis, 'setTimeout')
    const intervals = t.mock.method(globalThis, 'setInterval')
    for (const promise of [
      sdk.Noffer({ offer: 'o' }), sdk.Ndebit({}),
      sdk.Nmanage({ resource: 'offer', action: 'list' }), sdk.Nbeacon(),
      sdk.Nenroll(), sdk.Nenroll({ difficulty: 0 }),
    ]) await assert.rejects(promise, aborted)
    t.mock.timers.tick(60000)
    assert.deepEqual(order, ['destroy'])
    assert.equal(timeouts.mock.callCount(), 0)
    assert.equal(intervals.mock.callCount(), 0)
  })

  for (const discoveryFinished of [false, true]) {
    it(`does not send enrollment when stopped ${discoveryFinished ? 'after' : 'during'} beacon discovery`, async (t) => {
      const { sdk, subscriptions, published } = setup(t)
      const rejected = assert.rejects(sdk.Nenroll(), aborted)
      assert.equal(subscriptions.length, 1)
      assert.equal(subscriptions[0].filter.kinds[0], CLINK_BEACON_KIND)
      if (discoveryFinished) subscriptions[0].opts.oneose()
      sdk.Stop()
      await rejected
      subscriptions[0].opts.oneose()
      t.mock.timers.tick(60000)
      assert.equal(subscriptions[0].closed, true)
      assert.equal(subscriptions.length, 1)
      assert.equal(published.length, 0)
    })
  }

  it('does not remine or send an enrollment retry after Stop', async (t) => {
    const { sdk, subscriptions, published } = setup(t)
    const rejected = assert.rejects(sdk.Nenroll({ difficulty: 0 }), aborted)
    // Do not yield: Stop runs before the await continuation that starts the retry.
    reply(subscriptions[0], { res: 'GFY', code: 5, required_difficulty: 1 })
    sdk.Stop()
    await rejected
    t.mock.timers.tick(60000)
    assert.equal(subscriptions.length, 1)
    assert.equal(published.length, 1)
  })

  it('closes a subscription returned after synchronous Stop and never publishes', async (t) => {
    let sdk
    const context = setup(t, { onSubscribe: () => sdk.Stop() })
    sdk = context.sdk
    await assert.rejects(sdk.Ndebit({}), aborted)
    assert.equal(context.subscriptions[0].closed, true)
    assert.equal(context.published.length, 0)
    t.mock.timers.tick(60000)
    assert.equal(context.subscriptions.length, 1)
  })

  it('does not resubscribe if closing the previous subscription triggers Stop', async (t) => {
    const { sdk, subscriptions } = setup(t)
    const primary = sdk.Noffer({ offer: 'o' }, t.mock.fn())
    await reply(subscriptions[0], { bolt11: 'lnbc1dummy' })
    await primary
    const close = subscriptions[0].close
    subscriptions[0].close = () => { close(); sdk.Stop() }
    t.mock.timers.tick(4000)
    t.mock.timers.tick(60000)
    assert.equal(subscriptions.length, 1)
  })

  it('does not cancel another instance sharing the same pool', async (t) => {
    const { sdk, pool, subscriptions } = setup(t)
    const other = new ClinkSDK(settings, pool)
    const cancelled = assert.rejects(sdk.Ndebit({}), aborted)
    const active = other.Ndebit({})
    sdk.Stop()
    await cancelled
    assert.equal(subscriptions[0].closed, true)
    assert.equal(subscriptions[1].closed, false)
    await reply(subscriptions[1], { res: 'ok' })
    assert.deepEqual(await active, { res: 'ok' })
    other.Stop()
  })
})

describe('standalone cancellation', () => {
  it('accepts already-aborted trailing signals without network or timer activity', async (t) => {
    const { pool, order } = setup(t)
    const controller = new AbortController()
    const reason = new Error('cancelled by caller')
    controller.abort(reason)
    const signal = controller.signal
    const timeouts = t.mock.method(globalThis, 'setTimeout')
    const intervals = t.mock.method(globalThis, 'setInterval')
    for (const promise of [
      SendNofferRequest(pool, clientPriv, relays, serverPub, { offer: 'o' }, undefined, undefined, signal),
      SendNdebitRequest(pool, clientPriv, relays, serverPub, {}, undefined, signal),
      SendNmanageRequest(pool, clientPriv, relays, serverPub, {}, undefined, signal),
      SendNenrollRequest(pool, clientPriv, relays, serverPub, 0, undefined, signal),
      FetchClinkBeacon(pool, relays, serverPub, undefined, signal),
      sendRequest(pool, { privateKey: clientPriv, publicKey: clientPub }, relays, serverPub,
        {}, 21001, undefined, undefined, signal),
    ]) await assert.rejects(promise, error => error === reason)
    assert.deepEqual(order, [])
    assert.equal(timeouts.mock.callCount(), 0)
    assert.equal(intervals.mock.callCount(), 0)
    assert.equal(getEventListeners(signal, 'abort').length, 0)
  })

  it('ignores callbacks fired by an earlier abort listener before its own cleanup runs', async (t) => {
    const { pool, subscriptions } = setup(t)
    const controller = new AbortController()
    const receipt = t.mock.fn()
    controller.signal.addEventListener('abort', () => {
      subscriptions[0].opts.onclose([])
      reply(subscriptions[0], { res: 'ok' })
    }, { once: true })
    const primary = SendNofferRequest(pool, clientPriv, relays, serverPub,
      { offer: 'o' }, undefined, receipt, controller.signal)
    await reply(subscriptions[0], { bolt11: 'lnbc1dummy' })
    await primary
    const timeouts = t.mock.method(globalThis, 'setTimeout')
    controller.abort()
    assert.equal(timeouts.mock.callCount(), 0)
    assert.equal(receipt.mock.callCount(), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    t.mock.timers.tick(60000)
    assert.equal(subscriptions.length, 1)
  })

  for (const outcome of ['primary error', 'receipt', 'abort', 'timeout', 'publish failure']) {
    it(`removes the sender abort listener after ${outcome}`, async (t) => {
      const { pool, subscriptions } = setup(t)
      if (outcome === 'publish failure') pool.publish = () => [Promise.reject(new Error('refused'))]
      const controller = new AbortController()
      const signal = controller.signal
      const receipt = t.mock.fn()
      const primary = SendNofferRequest(pool, clientPriv, relays, serverPub, { offer: 'o' }, 1, receipt, signal)
      assert.equal(getEventListeners(signal, 'abort').length, 1)
      if (outcome === 'primary error') {
        await reply(subscriptions[0], { code: 1, error: 'unavailable' })
        await primary
      } else if (outcome === 'receipt') {
        await reply(subscriptions[0], { bolt11: 'lnbc1dummy' })
        await primary
        assert.equal(getEventListeners(signal, 'abort').length, 1)
        await reply(subscriptions[0], { res: 'ok' })
        assert.equal(receipt.mock.callCount(), 1)
      } else {
        const rejected = assert.rejects(primary)
        if (outcome === 'abort') controller.abort()
        if (outcome === 'timeout') t.mock.timers.tick(1000)
        await rejected
      }
      assert.equal(getEventListeners(signal, 'abort').length, 0)
      controller.abort()
      t.mock.timers.tick(60000)
      assert.equal(subscriptions.length, 1)
      assert.equal(subscriptions[0].closed, true)
    })
  }

  for (const outcome of ['eose', 'abort', 'timeout', 'subscribe failure', 'synchronous eose', 'synchronous abort']) {
    it(`cleans up beacon subscriptions and listeners after ${outcome}`, async (t) => {
      const controller = new AbortController()
      const signal = controller.signal
      const { pool, subscriptions } = setup(t, {
        onSubscribe: sub => {
          if (outcome === 'synchronous eose') sub.opts.oneose()
          if (outcome === 'synchronous abort') controller.abort()
        },
      })
      if (outcome === 'subscribe failure') pool.subscribe = () => { throw new Error('subscribe failed') }
      const beacon = FetchClinkBeacon(pool, relays, serverPub, 1, signal)
      const checked = outcome.includes('abort') || outcome === 'subscribe failure'
        ? assert.rejects(beacon) : assert.doesNotReject(async () => assert.equal(await beacon, null))
      if (outcome === 'eose') subscriptions[0].opts.oneose()
      if (outcome === 'abort') controller.abort()
      if (outcome === 'timeout') t.mock.timers.tick(1000)
      await checked
      assert.equal(getEventListeners(signal, 'abort').length, 0)
      if (subscriptions.length) {
        assert.equal(subscriptions[0].closed, true)
        subscriptions[0].opts.onevent({})
        subscriptions[0].opts.oneose()
      }
      controller.abort()
      t.mock.timers.tick(60000)
      assert.ok(subscriptions.length <= 1)
    })
  }
})
