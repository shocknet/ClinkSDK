#!/usr/bin/env node
/** Poll until READY_FILE exists (responder EOSE). */
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const readyFile = process.env.READY_FILE
const timeoutMs = Number(process.env.READY_WAIT_MS || 30000)
if (!readyFile) {
  console.error('READY_FILE required')
  process.exit(1)
}

const started = Date.now()
while (Date.now() - started < timeoutMs) {
  if (existsSync(readyFile)) {
    console.log(`[wait-for-ready] ${readyFile}`)
    process.exit(0)
  }
  await sleep(100)
}

console.error(`[wait-for-ready] timed out waiting for ${readyFile}`)
process.exit(1)
