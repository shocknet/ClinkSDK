# Troubleshooting & Interoperability Guide

This guide covers common integration issues, dependency conflicts, and language porting guidelines for the CLINK SDK.

---

## Table of Contents

1. [Nostr-Tools Dependency Conflicts](#1-nostr-tools-dependency-conflicts)
2. [Troubleshooting "No Response" / Timeouts](#2-troubleshooting-no-response--timeouts)
3. [Porting to Other Languages (C#, Go, etc.)](#3-porting-to-other-languages-c-go-etc)

---

## 1. Nostr-Tools Dependency Conflicts

**Do not install `nostr-tools` as a direct dependency in your application.**

This SDK pins a compatible version. A second copy in your app’s dependency tree often causes silent timeouts — missed replies or payloads that won’t decrypt — even though the peer is responding correctly.

### Why a second copy causes that
When multiple versions of `nostr-tools` exist in your dependency tree:
- **Separate pools:** A `SimplePool` from your copy and one from the SDK do not share connection state, so events can land on a socket your code isn’t listening on.
- **NIP-44 drift:** Different builds of `nip44` can disagree on encrypt/decrypt, so replies arrive but never parse.

### How to import Nostr helpers
Import all required Nostr values and types directly from `@shocknet/clink-sdk` instead of `nostr-tools`:

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

---

## 2. Troubleshooting "No Response" / Timeouts

If your application sends a request (Offer, Debit, or Manage) but times out waiting for a response, it is almost always due to one of the following:

### A. Wrong NIP-44 Encryption Implementation
If you are communicating with a peer running a different implementation (e.g. a custom C# plugin or an older wallet), an encryption mismatch will cause incoming responses to be undecryptable. The SDK will silently ignore undecryptable events and eventually time out.
- **Check:** Ensure both sides use NIP-44 v2 spec-compliant encryption. See the [Porting](#3-porting-to-other-languages-c-go-etc) section below for exact vector specifications.

### B. Publish-Before-Subscribe Race Condition
If you publish a request to a relay *before* setting up your subscription for the response, a fast responder (like a CLINK wallet) may publish its reply before your subscription is active.
- **Check:** Always establish your subscription filter (listening for `#e` matching your request event ID) *before* sending the `EVENT` message to the relay. The `@shocknet/clink-sdk` handles this order of operations internally.

### C. Leaking Subscriptions
If you are managing your own relay subscriptions or connection loops, failing to close old subscriptions will leak resources and can degrade relay performance or cause connection limits to be hit.
- **Check:** Ensure you call `close()` on the subscription handle (`SubCloser`) as soon as the primary response is received.

---

## 3. Porting to Other Languages (C#, Go, etc.)

If you are writing a CLINK client or plugin in a language other than TypeScript/JavaScript, **do not implement NIP-44 or the CLINK TLV/Bech32 encoding from scratch without testing against the official vectors.**

Refer to [`test-vectors/interop.json`](../test-vectors/interop.json) as the strict contract for interoperability.

### Common Language Porting Footguns

| Mistake | What went wrong | Symptom |
|---------|-----------------|---------|
| **Incorrect Conversation Key Salt** | Deriving the conversation key using `HMAC("nip44-v2", sharedX)` instead of `HKDF-Extract(salt="nip44-v2", IKM=sharedX)`. | Peer cannot decrypt your events; you cannot decrypt theirs. |
| **Incorrect Message Keys Derivation** | Using a custom HKDF info string (like `"nip44-v2-keys"`) instead of a single `HKDF-Expand` with the 32-byte raw nonce as info. | Same as above. |
| **2-Byte TLV Lengths** | Encoding or parsing TLV lengths as 2-byte big-endian integers. CLINK TLV uses **1-byte lengths** (`type (1) \| length (1) | value (length)`). | `noffer1` / `ndebit1` strings decode into garbage; routing/auth fails. |
| **Swapped TLV Tags** | Swapping tag `0` (pubkey) and tag `1` (relay). Tag `0` must be the 32-byte raw public key; tag `1` must be the UTF-8 relay URL. | Bech32 strings fail to decode or route to the wrong relay. |
| **Publish, then Subscribe** | Publishing the request event to the relay before sending the subscription request. | Intermittent timeouts, especially on fast relays or local networks. |

### Recommended Porting Workflow
1. **Assert Bech32/TLV Decodes:** Verify your decoder can parse the sample `noffer` and `ndebit` strings in `test-vectors/interop.json` and extract the exact fields.
2. **Assert NIP-44 Key Derivation:** Verify that your ECDH shared-secret and HKDF key derivation matches the fixed conversation-key vector in `test-vectors/interop.json`.
3. **Test E2E with a Relay:** Verify your client can communicate with a standard JS/TS client or wallet before deploying to production.
