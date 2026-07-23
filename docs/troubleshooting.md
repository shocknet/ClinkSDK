# Troubleshooting & Interoperability Guide

---

## Table of Contents

1. [Nostr-tools dependency conflicts](#1-nostr-tools-dependency-conflicts)
2. [Troubleshooting "no response" / timeouts](#2-troubleshooting-no-response--timeouts)
3. [Porting to other languages](#3-porting-to-other-languages)

---

## 1. Nostr-tools dependency conflicts

**Do not install `nostr-tools` yourself.** This package pins a compatible version. Import helpers from `@shocknet/clink-sdk` instead.

A second copy in the dependency tree often causes missed replies or undecryptable payloads — the peer may be fine; your client never sees a usable response.

| Cause | What happens |
|-------|----------------|
| Separate `SimplePool` instances | Pool from your copy and pool from the SDK do not share sockets; events land on a connection you aren’t listening on. |
| Divergent `nip44` builds | Encrypt/decrypt disagree; replies arrive but fail to decrypt and are dropped. |

```ts
import {
  ClinkSDK,
  SimplePool,
  getPublicKey,
  finalizeEvent,
  nip44,
  verifyEvent,
  type AbstractSimplePool,
  type UnsignedEvent,
} from '@shocknet/clink-sdk';
```

If you pass a custom `pool` into `ClinkSDK`, create it with `SimplePool` from this package.

---

## 2. Troubleshooting "no response" / timeouts

Most often the peer service is down, or your client is not connected to the relay. Confirm both before debugging further.

If the service is up and the relay connection is open, a timeout is usually one of:

### A. Wrong NIP-44
Replies arrive but fail to decrypt; the SDK drops them and the request waits until timeout.
- **Check:** Both sides use NIP-44 v2. See [Porting](#3-porting-to-other-languages) for key derivation. JS apps: use `nip44` from this package, not a separate install.

### B. Publish before subscribe
The reply is published before your listener is attached; the event is missed and surfaces as a timeout.
- **Check:** Subscribe for the reply (`#e` = request id) *before* sending the request `EVENT`. `@shocknet/clink-sdk` does this internally.

### C. Leaking subscriptions
Leaving subscriptions open after the primary response wastes relay slots and can hit connection limits on long-running processes.
- **Check:** Call `close()` on the `SubCloser` when the primary response arrives. The SDK does this for you.

---

## 3. Porting to other languages

Two stacks must match this SDK:

1. **NIP-44 v2** — encrypt/decrypt of kind `21001` / `21002` / `21003` content.
2. **NIP-19-style bech32** — `noffer1` / `ndebit1` / `nmanage1`. Same layout as other NIP-19 entities (`nprofile`, etc.): bech32 around a TLV byte stream. CLINK only defines the HRPs and tag meanings.

Implement against [`test-vectors/interop.json`](../test-vectors/interop.json).

### Common mistakes

| Mistake | Detail | Symptom |
|---------|--------|---------|
| **Wrong conversation key** | `HMAC("nip44-v2", sharedX)` instead of `HKDF-Extract(salt="nip44-v2", IKM=sharedX)`. | Undecryptable events appear as timeouts. |
| **Wrong message keys** | Custom HKDF info (e.g. `"nip44-v2-keys"`) instead of `HKDF-Expand` with the raw 32-byte nonce as info. | Same. |
| **2-byte TLV lengths** | NIP-19 TLV is `type (1) \| length (1) \| value (length)` — length is one byte (0–255), not a 2-byte big-endian int. | Bech32 decode fails or fields are garbage. |
| **Wrong / missing TLV tags** | Tags and meanings are in `interop.json`. Tag `0` is 32 raw pubkey bytes (not UTF-8 hex); tag `1` is the relay URL. Omit a required tag, swap 0/1, or UTF-8-decode the pubkey and the pointer is wrong. | Decoded pubkey/relay/offer/pointer mismatch; requests misroute or fail auth. |
| **Publish before subscribe** | Sending the request `EVENT` before subscribing for the reply (`#e` = request id). | Missed responses appear as timeouts when the peer replies quickly. |

### Porting checklist
1. Decode the sample `noffer1` / `ndebit1` strings in `interop.json`; assert every field matches.
2. Assert your NIP-44 conversation key matches the fixed vector in `interop.json`.
3. Only then test end-to-end against a known-good JS client over a relay.
