#!/usr/bin/env node
/**
 * Prior-SDK CLINK responder (emulates a 1.5.x app peer).
 *
 * Env:
 *   RELAY_URL — default ws://127.0.0.1:7777
 *   SERVER_NSEC_HEX — 64-hex private key (required)
 *   RECEIPT_DELAY_MS — delay before synthetic receipt (default 10000)
 *   READY_FILE — path written when subscription EOSE received
 */
import { writeFileSync } from 'node:fs'
import { fromHex, loadPriorAppModules } from './paths.mjs'

const relayUrl = process.env.RELAY_URL || 'ws://127.0.0.1:7777'
const receiptDelayMs = Number(process.env.RECEIPT_DELAY_MS || 10000)
const readyFile = process.env.READY_FILE
const serverNsecHex = process.env.SERVER_NSEC_HEX

if (!serverNsecHex || serverNsecHex.length !== 64) {
  console.error('SERVER_NSEC_HEX (64 hex chars) required')
  process.exit(1)
}

const prior = await loadPriorAppModules()
const serverPriv = fromHex(serverNsecHex)
const serverPub = prior.getPublicKey(serverPriv)
const pool = new prior.SimplePool()

console.log(`[responder] prior=${prior.priorVersion} pubkey=${serverPub} relay=${relayUrl}`)

function buildPrimaryPayload(requestKind) {
  if (requestKind === 21001) {
    return { bolt11: 'lnbc1clinksdktestdummyinvoice0000000000000000000000000000000000000' }
  }
  if (requestKind === 21002) {
    return { res: 'ok', preimage: '00'.repeat(32) }
  }
  return { res: 'ok', resource: 'offer', details: [] }
}

function publishEncrypted(toPub, requestId, kind, payload) {
  const content = prior.nip44.encrypt(
    JSON.stringify(payload),
    prior.nip44.getConversationKey(serverPriv, toPub)
  )
  const event = prior.finalizeEvent(
    {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', toPub],
        ['e', requestId],
        ['clink_version', '1'],
      ],
      content,
    },
    serverPriv
  )
  return Promise.all(pool.publish([relayUrl], event))
}

let eoseSeen = false
pool.subscribeMany(
  [relayUrl],
  [
    {
      kinds: [21001, 21002, 21003],
      '#p': [serverPub],
      since: Math.floor(Date.now() / 1000) - 5,
    },
  ],
  {
    oneose: () => {
      if (eoseSeen) return
      eoseSeen = true
      console.log('[responder] EOSE — ready for requests')
      if (readyFile) writeFileSync(readyFile, `${Date.now()}\n`)
    },
    onevent: async (event) => {
      try {
        const plain = JSON.parse(
          prior.nip44.decrypt(
            event.content,
            prior.nip44.getConversationKey(serverPriv, event.pubkey)
          )
        )
        console.log(`[responder] request kind=${event.kind} id=${event.id} body=`, plain)
        await publishEncrypted(event.pubkey, event.id, event.kind, buildPrimaryPayload(event.kind))
        console.log(`[responder] primary reply published for ${event.id}`)

        if (event.kind === 21001) {
          setTimeout(async () => {
            try {
              await publishEncrypted(event.pubkey, event.id, event.kind, { res: 'ok' })
              console.log(`[responder] receipt published for ${event.id}`)
            } catch (err) {
              console.error('[responder] receipt publish failed', err)
            }
          }, receiptDelayMs)
        }
      } catch (err) {
        console.error('[responder] failed to handle event', event.id, err)
      }
    },
  }
)

process.on('SIGINT', () => {
  pool.destroy?.()
  process.exit(0)
})
