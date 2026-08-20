# @shocknet/clink-sdk

[![CI](https://github.com/shocknet/ClinkSDK/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/shocknet/ClinkSDK/actions/workflows/test.yml)

**A TypeScript/JavaScript SDK for the CLINK protocol — Nostr-native static Lightning payment offers and debits.**

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [1. Encoding/Decoding Offers and Debits](#1-encodingdecoding-offers-and-debits)
  - [2. Sending a CLINK Offer Request (Lightning Invoice)](#2-sending-a-clink-offer-request-lightning-invoice)
  - [3. Sending a CLINK Debit Request](#3-sending-a-clink-debit-request)
  - [4. Beacon](#4-beacon)
  - [5. Enroll](#5-enroll)
- [API Reference](#api-reference)
  - [ClinkSDK](#clinksdk)
  - [Encoding/Decoding](#encodingdecoding)
  - [Validators](#validators)
  - [Nostr Helpers (re-exported)](#nostr-helpers-re-exported)
  - [Types](#types)
- [Troubleshooting & Language Porting](#troubleshooting--language-porting)
- [Protocol](#protocol)
- [License](#license)

---

## Overview

`@shocknet/clink-sdk` provides a simple, robust interface for working with [CLINK](https://github.com/shocknet/CLINK/) (`noffer1...` and `ndebit1...`) on Nostr. It enables applications and wallets to create, encode, decode, send, and receive CLINK payment requests and authorizations using Nostr relays, with full support for NIP-44 encryption and the CLINK protocol.

- **No web server or Onion Messaging required:** Unlike LNURL and Bolt12, all communication is over Nostr relays.
- **Compatible with [Lightning.Pub](https://github.com/shocknet/Lightning.Pub), [ShockWallet](https://shockwallet.app), and other CLINK-enabled apps.**
- **Implements the official [CLINK protocol](https://github.com/shocknet/CLINK).**

---

## Features

- Encode/decode CLINK Static Offers (`noffer1...`) and Debits (`ndebit1...`) per the spec.
- Send CLINK offer (21001), debit (21002), manage (21003), and enroll (21004) requests.
- Fetch a node `clink-node` beacon (kind 30078) for liveness, display, fees, and advertised kinds.
- NIP-44 encrypted payloads for privacy and security.
- TypeScript types for all protocol payloads and responses.
- Simple, high-level API for wallet and service integration.

---

## Installation

```bash
npm install @shocknet/clink-sdk
# or
yarn add @shocknet/clink-sdk
```

> ⚠️ **Important:** Do not install `nostr-tools` yourself. This SDK pins a compatible version; a second copy often causes decrypt failures and missed responses. Import helpers like `SimplePool`, `nip44`, and `finalizeEvent` from `@shocknet/clink-sdk`. Details: [Troubleshooting Guide](docs/troubleshooting.md).

---

## Usage

### 1. Encoding/Decoding Offers and Debits

```ts
import { nofferEncode, ndebitEncode, decodeBech32, OfferPriceType, generateK1 } from '@shocknet/clink-sdk';

// Encode a CLINK Offer
const noffer = nofferEncode({
  pubkey: '<receiver_pubkey_hex>',
  relay: 'wss://relay.example.com',
  offer: 'my_offer_id',
  priceType: OfferPriceType.Fixed,
  price: 1000 // sats
});

// Decode a CLINK Offer
const decoded = decodeBech32(noffer);
console.log(decoded);
// { type: 'noffer', data: { pubkey, relay, offer, priceType, price } }

// Encode a session ndebit — k1 is TLV type 3
const sessionNdebit = ndebitEncode({
  pubkey: '<node_service_pubkey_hex>',
  relay: 'wss://relay.example.com',
  pointer: '<app_user_pointer>',
  k1: generateK1(),
});
```

### 2. Sending a CLINK Offer Request (Lightning Invoice)

```ts
import { ClinkSDK, NofferData, generateSecretKey, decodeBech32 } from '@shocknet/clink-sdk';

// First, decode the offer string to get the relay and pubkey
const nofferString = 'noffer1qvqsyqjqxuurvwpcxc6rvvrxxsurqep5vfjk2wf4v33nsenrxumnyvesxfnrswfkvycrwdp3x93xydf5xg6rzce4vv6xgdfh8quxgct9x5erxvspremhxue69uhhgetnwskhyetvv9ujumrfva58gmnfdenjuur4vgqzpccxc30wpf78wf2q78wg3vq008fd8ygtl4qy06gstpye3h5unc47xmee6z';
const decoded = decodeBech32(nofferString);
if (decoded.type !== 'noffer') throw new Error('Invalid offer string');

// Create SDK instance with the decoded relay and pubkey
const sdk = new ClinkSDK({
  privateKey: generateSecretKey(), // Uint8Array
  relays: [decoded.data.relay],
  toPubKey: decoded.data.pubkey,
});

const request: NofferData = {
  offer: decoded.data.offer,
  amount_sats: 1000, // sats (optional for variable/spontaneous offers)
  description: 'coffee for bob', // optional, max 100 chars
  expires_in_seconds: 3600, // optional
  payer_data: { name: 'Alice' }, // optional
};

// Optional: Pass a receipt callback to be notified when the invoice is paid
const receiptCallback = (receipt) => {
  console.log("got receipt", receipt); // receipt will be { res: 'ok' }
};
sdk.Noffer(request, receiptCallback).then(response => {
  if ('bolt11' in response) {
    console.log('Invoice:', response.bolt11);
  } else {
    console.error('Error:', response.error);
  }
});
```

### 3. Sending a CLINK Debit Request

```ts
import {
  ClinkSDK,
  decodeBech32,
  generateSecretKey,
  newNdebitPaymentRequest,
  newNdebitFullAccessRequest,
  newNdebitBudgetRequest,
} from '@shocknet/clink-sdk';

// Session flow: scan ndebit QR, pay with matching k1
const scanned = decodeBech32('ndebit1...');
if (scanned.type === 'ndebit') {
  const sessionSdk = new ClinkSDK({
    privateKey: generateSecretKey(),
    relays: [scanned.data.relay],
    toPubKey: scanned.data.pubkey,
  });
  const sessionPayment = newNdebitPaymentRequest(
    '<BOLT11_invoice_string>',
    5000,
    scanned.data.pointer,
    scanned.data.k1,
  );
  sessionSdk.Ndebit(sessionPayment).then(/* ... */);
}

// Authorization flow: static pointer
const sdk = new ClinkSDK({
  privateKey: generateSecretKey(),
  relays: ['wss://relay.example.com'],
  toPubKey: '<wallet_service_pubkey_hex>',
});

// Request the service to pay an invoice
const simplePaymentRequest = newNdebitPaymentRequest('<BOLT11_invoice_string>', 5000, 'my_pointer_id');
// Optional: session k1 and/or description — newNdebitPaymentRequest(invoice, amount, pointer, k1?, description?)

sdk.Ndebit(simplePaymentRequest).then(response => {
  if (response.res === 'ok') {
    if ('preimage' in response) {
      console.log('Payment preimage:', response.preimage);
    } else {
      console.log('Payment settled internally.');
    }
  } else if (response.res === 'GFY') {
    console.error('Debit error:', response.error);
  }
});

// Request whitelisting for future payment requests
const fullAccessRequest = newNdebitFullAccessRequest('my_pointer_id');

sdk.Ndebit(fullAccessRequest).then(response => {
  if (response.res === 'ok') {
    console.log('Full access approved:');
  } else if (response.res === 'GFY') {
    console.error('Full access request failed:', response.error);
  }
});

// Request a budget
const budgetRequest = newNdebitBudgetRequest({ number: 1, unit: 'week' }, 1000, 'my_pointer_id');

sdk.Ndebit(budgetRequest).then(response => {
  if (response.res === 'ok') {
    console.log('Budget approved:');
  } else if (response.res === 'GFY') {
    console.error('Budget request failed:', response.error);
  }
});
```

### 4. Beacon

Optional. Useful for rich display of node persona (name, avatar, fees, kinds). Recommended for the enroll fast-path: mine at `enroll_difficulty` instead of probing.

```ts
import { ClinkSDK, generateSecretKey } from '@shocknet/clink-sdk';

const sdk = ClinkSDK.fromNprofile('nprofile1...', generateSecretKey());
const beacon = await sdk.Nbeacon();
if (!beacon) throw new Error('no beacon');

console.log(beacon.content.name, beacon.content.fees, beacon.content.supported_kinds);
sdk.Stop();
```

### 5. Enroll

Enroll binds your signing key to an account and returns that account's `noffer` / `ndebit` / `nmanage`.

```ts
import { ClinkSDK, generateSecretKey, decodeBech32 } from '@shocknet/clink-sdk';

const sdk = ClinkSDK.fromNprofile('nprofile1...', generateSecretKey());
const enrolled = await sdk.Nenroll();
if (enrolled.res !== 'ok') throw new Error(enrolled.error);

const noffer = decodeBech32(enrolled.noffer);
if (noffer.type !== 'noffer') throw new Error('expected noffer');
const invoice = await sdk.Noffer({ offer: noffer.data.offer, amount_sats: 21 });

sdk.Stop();
```

`Nenroll()` with no args uses a fresh beacon's `enroll_difficulty` when present, otherwise probes and remine once on GFY `5`. Pass `{ difficulty: 0 }` to probe, or `{ difficulty: 18 }` to skip the lookup. Mining is capped at `MAX_ENROLL_POW_BITS` (24). A beacon or GFY asking for more is ignored (probe / return the GFY); an explicit `{ difficulty }` above the cap throws.

---

## API Reference

### ClinkSDK

```ts
new ClinkSDK(settings: ClinkSettings, pool?: AbstractSimplePool)
ClinkSDK.fromNprofile(nprofile: string, privateKey: Uint8Array, opts?: { defaultTimeoutSeconds?: number, pool?: AbstractSimplePool })
```
- `settings`: `{ privateKey: Uint8Array, relays: string[], toPubKey: string, defaultTimeoutSeconds?: number }`
- `fromNprofile`: decodes service pubkey + relays from an `nprofile`.
- `pool`: Optional custom Nostr pool (defaults to `SimplePool` from this package’s pinned `nostr-tools`). If you pass one, build it with `SimplePool` imported from `@shocknet/clink-sdk`.

#### Methods
- `Noffer(data: NofferData, onReceipt?: (receipt: NofferReceipt) => void, timeoutSeconds?: number)`
  - Sends a `kind: 21001` offer request.
  - Returns a `Promise<NofferResponse>` that resolves with the invoice or an error.
  - The optional `onReceipt` callback is triggered when the invoice is paid. **You must pass the callback as a parameter**—simply defining it is not enough.
- `Ndebit(data: NdebitData, timeoutSeconds?: number)`
  - Sends a `kind: 21002` debit request.
  - Returns a `Promise<NdebitResponse>` that resolves with the payment/budget confirmation or an error.
- `Nmanage(data: NmanageRequest, timeoutSeconds?: number)`
  - Sends a `kind: 21003` management request.
  - Returns a `Promise<NmanageResponse>` that resolves with the result of the management action.
- `Nbeacon(timeoutSeconds?: number)`
  - Fetches the latest kind `30078` `d=clink-node` beacon (liveness, display, fees, advertised kinds).
- `Nenroll(opts?: { difficulty?: number }, timeoutSeconds?: number)`
  - Sends a kind `21004` Enroll request (`{}`). Mines NIP-13 when `difficulty > 0`, up to `MAX_ENROLL_POW_BITS` (24). If `difficulty` is omitted, uses a fresh beacon’s `enroll_difficulty` when present and in range, otherwise probes and remine once on GFY `5`.
- `Stop()`
  - Closes relay connections on the internal pool. Call when finished so the process can exit cleanly.


### Encoding/Decoding
- `nofferEncode(offer: OfferPointer): string`
- `ndebitEncode(debit: DebitPointer): string`
- `nmanageEncode(manage: ManagePointer): string`
- `decodeBech32(nip19: string): DecodeResult`
- `generateK1(): string` — 32-byte session identifier as lowercase hex (ndebit TLV `3`)
- `validateK1(k1: unknown): string` — throws unless `k1` is 64 lowercase hex chars; returns it unchanged

### Validators

For validating inbound/outbound CLINK payloads (e.g. server-side request checks). Each throws on invalid input and returns the typed value on success:

- `validateNofferData`, `validateNdebitData`, `validateK1`, `validateBudgetFrequency`
- `validateNmanageRequest` and per-action helpers: `validateNmanageCreateOffer`, `validateNmanageUpdateOffer`, `validateNmanageDeleteOffer`, `validateNmanageGetOffer`, `validateNmanageListOffers`, `validateOfferFields`

### Debug
- `setDebug(enabled: boolean)` — when `true`, logs relay subscribe/publish/response lifecycle to the console (default `false`)

### Nostr helpers (re-exported)

Pinned by this package — import these from `@shocknet/clink-sdk`, not from a separate `nostr-tools` install:

| Export | Kind | Use |
|--------|------|-----|
| `SimplePool` | value | Default relay pool; use this if you pass a custom `pool` |
| `getPublicKey` | value | Derive pubkey from secret key |
| `generateSecretKey` | value | Create a new secret key |
| `nip19` | value | Bech32 encode/decode (`npub` / `nsec` / …) |
| `finalizeEvent` | value | Sign an unsigned event |
| `nip44` | value | Encrypt/decrypt CLINK payloads (`encrypt`, `decrypt`, `getConversationKey`) |
| `verifyEvent` | value | Verify event signatures (e.g. NIP-98) |
| `AbstractSimplePool` | type | Type for a custom `pool` argument |
| `UnsignedEvent` | type | Event shape before `finalizeEvent` |

### Types
- **`NofferData`**: `{ offer: string, amount_sats?: number, description?: string, expires_in_seconds?: number, zap?: string, payer_data?: Record<string, string> }`
- **`NofferResponse`**: `{ bolt11: string } | { code: number, error: string, range?: { min: number, max: number } }`
- **`NofferReceipt`**: `{ res: 'ok' }` - The receipt object sent when an invoice is paid
- **`NdebitData`**: `{ pointer?: string, amount_sats?: number, bolt11?: string, frequency?: BudgetFrequency, k1?: string, description?: string }`
- **`NdebitResponse`**: `{ res: 'ok', preimage?: string } | { res: 'GFY', error: string, code: number }`
- **`OfferPointer`**: `{ pubkey: string, relay: string, offer: string, priceType: OfferPriceType, price?: number }`
- **`DebitPointer`**: `{ pubkey: string, relay: string, pointer?: string, k1?: string }`
- **`OfferPriceType`**: `enum { Fixed = 0, Variable = 1, Spontaneous = 2 }`
- **`BudgetFrequency`**: `{ number: number, unit: 'day' | 'week' | 'month' }`
- **`ClinkSettings`**: `{ privateKey: Uint8Array, relays: string[], toPubKey: string, defaultTimeoutSeconds?: number }`
- **`NenrollResponse`**: `{ res: 'ok', noffer: string, ndebit: string, nmanage: string } | { res: 'GFY', code: number, error: string, required_difficulty?: number }`
- **`ClinkBeacon`**: `{ pubkey: string, created_at: number, operator?: string, content: ClinkBeaconContent }`
- **`AbstractSimplePool`**, **`UnsignedEvent`**: see Nostr helpers above

---

## Troubleshooting & Language Porting

- `nostr-tools` conflicts, timeouts, and NIP-44 / NIP-19 ports: [docs/troubleshooting.md](docs/troubleshooting.md)
- Interop vectors for language ports: [test-vectors/interop.json](test-vectors/interop.json)

---

## Protocol

- [CLINK Protocol Overview](https://github.com/shocknet/CLINK)

---

## License

MIT
