#!/usr/bin/env node
/** Wait until RELAY_URL accepts a WebSocket connection. */
import { setTimeout as sleep } from 'node:timers/promises'

const relayUrl = process.env.RELAY_URL || 'ws://127.0.0.1:7777'
const timeoutMs = Number(process.env.RELAY_WAIT_MS || 60000)
const started = Date.now()

while (Date.now() - started < timeoutMs) {
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('connect timeout'))
      }, 3000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        ws.close()
        resolve()
      })
      ws.addEventListener('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    console.log(`[wait-for-relay] ready: ${relayUrl}`)
    process.exit(0)
  } catch {
    await sleep(500)
  }
}

console.error(`[wait-for-relay] timed out waiting for ${relayUrl}`)
process.exit(1)
