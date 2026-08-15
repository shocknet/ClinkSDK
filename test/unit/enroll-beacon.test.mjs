import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, finalizeEvent, nip19, nip44 } from 'nostr-tools'
import {
  countLeadingZeroBits,
  mineNip13,
  FetchClinkBeacon,
  parseClinkBeaconContent,
  parseClinkBeaconEvent,
  beaconIsFresh,
  enrollDifficultyFromBeacon,
  newNenrollEvent,
  SendNenrollRequest,
  CLINK_ENROLL_KIND,
  CLINK_BEACON_KIND,
  CLINK_BEACON_D_TAG,
  CLINK_VERSION,
  ClinkSDK,
} from '../../build/index.js'

const { getConversationKey, encrypt } = nip44

describe('nip13 mining', () => {
  it('counts leading zero bits', () => {
    assert.equal(countLeadingZeroBits('0'.repeat(64)), 256)
    assert.equal(countLeadingZeroBits('f'.repeat(64)), 0)
    assert.equal(countLeadingZeroBits('1' + 'f'.repeat(63)), 3)
  })

  it('mines an enroll event to the committed target', () => {
    const priv = generateSecretKey()
    const event = newNenrollEvent('{}', getPublicKey(priv), 'cd'.repeat(32))
    const mined = mineNip13(event, 8)
    const nonce = mined.tags.find(t => t[0] === 'nonce')
    assert.ok(nonce)
    assert.equal(nonce[2], '8')
    const signed = finalizeEvent(mined, priv)
    assert.ok(countLeadingZeroBits(signed.id) >= 8)
  })

  it('leaves the event alone when bits are 0', () => {
    const event = newNenrollEvent('{}', 'ab'.repeat(32), 'cd'.repeat(32))
    assert.equal(mineNip13(event, 0), event)
    assert.equal(event.tags.some(t => t[0] === 'nonce'), false)
  })
})

describe('beacon parse', () => {
  const now = Math.floor(Date.now() / 1000)
  const servicePriv = generateSecretKey()
  const servicePub = getPublicKey(servicePriv)

  const signBeacon = (overrides = {}) => finalizeEvent({
    kind: CLINK_BEACON_KIND,
    created_at: now,
    tags: [['d', CLINK_BEACON_D_TAG], ['clink_version', CLINK_VERSION]],
    content: '{}',
    ...overrides,
  }, servicePriv)

  it('parses clink-node content and ignores junk', () => {
    const content = parseClinkBeaconContent({
      name: 'test pub',
      enroll_difficulty: 18,
      supported_kinds: [21001, 21004],
      fees: { serviceFeeFloor: 1, serviceFeeBps: 60 },
      extra: 'nope',
    })
    assert.equal(content.name, 'test pub')
    assert.equal(content.enroll_difficulty, 18)
    assert.deepEqual(content.supported_kinds, [21001, 21004])
    assert.deepEqual(content.fees, { serviceFeeFloor: 1, serviceFeeBps: 60 })
  })

  it('rejects unsigned and forged events', () => {
    const unsigned = {
      kind: CLINK_BEACON_KIND,
      pubkey: servicePub,
      created_at: now,
      tags: [['d', CLINK_BEACON_D_TAG], ['clink_version', CLINK_VERSION]],
      content: JSON.stringify({ enroll_difficulty: 1 }),
      id: '00'.repeat(32),
      sig: '00'.repeat(64),
    }
    assert.equal(parseClinkBeaconEvent(unsigned), null)
  })

  it('rejects legacy d-tag and missing version', () => {
    assert.equal(parseClinkBeaconEvent(signBeacon({
      tags: [['d', 'Lightning.Pub'], ['clink_version', CLINK_VERSION]],
    })), null)
    assert.equal(parseClinkBeaconEvent(signBeacon({
      tags: [['d', CLINK_BEACON_D_TAG]],
    })), null)
  })

  it('uses enroll_difficulty only while the beacon is fresh', () => {
    const beacon = parseClinkBeaconEvent(signBeacon({
      tags: [['d', CLINK_BEACON_D_TAG], ['clink_version', CLINK_VERSION], ['operator', 'CD'.repeat(32)]],
      content: JSON.stringify({ enroll_difficulty: 18 }),
    }))
    assert.ok(beacon)
    assert.equal(beacon.pubkey, servicePub)
    assert.equal(beacon.operator, 'cd'.repeat(32))
    assert.equal(beaconIsFresh(beacon, now * 1000), true)
    assert.equal(enrollDifficultyFromBeacon(beacon, now * 1000), 18)
    assert.equal(enrollDifficultyFromBeacon(beacon, (now + 181) * 1000), undefined)
    assert.equal(beaconIsFresh(beacon, (now - 31) * 1000), false)
  })

  it('ignores unsigned relay spoofs when fetching', async () => {
    const signed = signBeacon({
      created_at: now,
      content: JSON.stringify({ enroll_difficulty: 18, name: 'real' }),
    })
    const spoof = {
      kind: signed.kind,
      pubkey: signed.pubkey,
      created_at: now + 10,
      tags: signed.tags,
      content: JSON.stringify({ enroll_difficulty: 1, name: 'fake' }),
      id: '11'.repeat(32),
      sig: '11'.repeat(64),
    }
    const pool = {
      subscribeMany(_relays, _filters, opts) {
        queueMicrotask(() => {
          opts.onevent(spoof)
          opts.onevent(signed)
          opts.oneose()
        })
        return { close: () => {} }
      },
    }
    const beacon = await FetchClinkBeacon(pool, ['wss://relay.example'], servicePub, 2)
    assert.ok(beacon)
    assert.equal(beacon.content.name, 'real')
    assert.equal(beacon.content.enroll_difficulty, 18)
  })
})

describe('enroll event', () => {
  it('is kind 21004 with empty-object payload tags', () => {
    const event = newNenrollEvent('{}', 'aa'.repeat(32), 'bb'.repeat(32))
    assert.equal(event.kind, CLINK_ENROLL_KIND)
    assert.deepEqual(event.tags, [['p', 'bb'.repeat(32)], ['clink_version', CLINK_VERSION]])
  })
})

describe('fromNprofile', () => {
  it('sets relays and service pubkey', () => {
    const nprofile = 'nprofile1qy08wumn8ghj7ar9wd6z6un9d3shjtnvd9nksarwd9hxwtnsw43qqg8rqmz9ac98cae9grcaez9spaua95u3p075q3lfzpvynxx7nj0zhc7z748z'
    const sdk = ClinkSDK.fromNprofile(nprofile, generateSecretKey())
    assert.deepEqual(sdk.settings.relays, ['wss://test-relay.lightning.pub'])
    assert.equal(sdk.settings.toPubKey, 'e306c45ee0a7c772540f1dc88b00f79d2d3910bfd4047e910584998de9c9e2be')
    sdk.Stop()
  })

  it('rejects non-nprofile bech32', () => {
    const npub = nip19.npubEncode('00'.repeat(32))
    assert.throws(() => ClinkSDK.fromNprofile(npub, generateSecretKey()))
  })
})

describe('enroll remine', () => {
  it('probes then remine once on GFY 5', async () => {
    const clientPriv = generateSecretKey()
    const clientPub = getPublicKey(clientPriv)
    const serverPriv = generateSecretKey()
    const serverPub = getPublicKey(serverPriv)
    const published = []
    let onevent = null
    const pool = {
      subscribeMany(_relays, _filters, opts) {
        onevent = opts.onevent
        return { close: () => {} }
      },
      publish(_relays, event) {
        published.push(event)
        const gfy = published.length === 1
        const payload = gfy
          ? { res: 'GFY', code: 5, error: 'Insufficient proof of work', required_difficulty: 8 }
          : { res: 'ok', noffer: 'noffer1x', ndebit: 'ndebit1x', nmanage: 'nmanage1x' }
        const reply = {
          id: `reply-${published.length}`,
          kind: CLINK_ENROLL_KIND,
          pubkey: serverPub,
          content: encrypt(JSON.stringify(payload), getConversationKey(serverPriv, clientPub)),
        }
        queueMicrotask(() => onevent(reply))
        return [Promise.resolve('ok')]
      },
    }
    const res = await SendNenrollRequest(pool, clientPriv, ['wss://relay.example'], serverPub, 0, 5)
    assert.equal(res.res, 'ok')
    assert.equal(published.length, 2)
    assert.equal(published[0].tags.some(t => t[0] === 'nonce'), false)
    const nonce = published[1].tags.find(t => t[0] === 'nonce')
    assert.equal(nonce[2], '8')
    assert.ok(countLeadingZeroBits(published[1].id) >= 8)
  })
})
