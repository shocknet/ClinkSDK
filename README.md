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
  amount_sats: 1000, // payer-selected unit price in sats for spontaneous offers
  description: 'coffee for bob', // optional, max 100 chars
  expires_in_seconds: 3600, // optional
  payer_data: { name: 'Alice' }, // optional
};

// Optional: Pass a receipt callback to be notified when the invoice is paid
const receiptCallback = (receipt) => {
  console.log("got receipt", receipt); // { res: 'ok' } or { res: 'ok', preimage: '...' }
};
sdk.Noffer(request, receiptCallback).then(response => {
  if ('bolt11' in response) {
    console.log('Invoice:', response.bolt11);
  } else {
    console.error('Error:', response.error);
  }
});
```

#### Payer Data Discovery and Quantity

An offer host can respond with code `6` and `payer_data: string[]` listing the required payer-data keys. Treat this as discovery: collect the requested values and explicitly retry the same offer with `payer_data` populated. The SDK preserves the list but does not collect values or retry automatically. For example, after receiving `{ code: 6, error: 'Missing payer data', payer_data: ['name', 'quantity'] }`:

```ts
const retry = await sdk.Noffer({
  ...request,
  payer_data: { ...request.payer_data, name: 'Alice', quantity: 2 },
});
```

The exact key `quantity` must be a positive safe integer JSON number, not a string. All other payer-data values must be strings. Undefined optional fields are treated as omitted. Invalid outgoing requests are rejected locally before encryption or relay contact.

When supplied, `amount_sats` must be a positive safe integer and `expires_in_seconds` must be a non-negative safe integer. Zero expiry is permitted; the host determines the resulting invoice expiry. Fractions, non-finite numbers, and unsafe integers are rejected rather than rounded or serialized as `null`.

Offer price categories describe the **unit price**: `Fixed = 0` is a fixed unit price, `Variable = 1` is resolved by the host on request, and `Spontaneous = 2` uses the payer's `amount_sats` as the unit price. Quantity multiplies the unit price only when the host's required payer-data list includes `quantity`; merely sending it does not enable multiplication. The host computes the invoice total, and wallets must verify that total before payment. The SDK client is not a pricing engine.

Receipt callbacks keep listening only after an invoice response. Discovery and other error responses close their subscriptions immediately; they cannot produce a receipt for that attempt.

#### Encoding Bounds

Each TLV value is limited to 255 bytes, measured after UTF-8 encoding for strings. Oversized offer IDs, pointers, relay URLs, and currency values are rejected before encoding.

All pointer encoders require a public key representing exactly 32 raw bytes (64 hexadecimal characters). Compressed 33-byte keys, truncated keys, and other lengths are rejected before a pointer is produced.

Encoded offer prices support integers from `0` through `Number.MAX_SAFE_INTEGER`. Existing nonzero 32-bit prices retain their four-byte encoding; larger prices use lossless wider big-endian values. An explicit zero price is encoded as zero rather than omitted. An absent price remains optional, and currency cannot be combined with any supplied price, including zero. Decoding rejects empty or unsafe price values instead of returning a rounded number.

Both `nip19.decode` and `nip19.decodeNostrURI` enforce printable ASCII. The URI helper retains its `{ type: 'invalid', data: null }` result for invalid inputs.

### 3. Sending a CLINK Debit Request

```ts
import {
  ClinkSDK,
  decodeBech32,
  generateSecretKey,
  newNdebitPaymentRequest,
  newNdebitFullAccessRequest,
  newNdebitBudgetRequest,
  gfy6Reason,
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
    if (response.reason === gfy6Reason.invoiceAlreadyFailed) {
      console.error('Submit a new invoice')
    } else if (response.reason === gfy6Reason.k1AlreadyProcessed) {
      console.error('Session already used')
    } else if (response.reason === gfy6Reason.invoiceInProgress) {
      console.error('Wait for the in-flight payment')
    } else if (response.reason === gfy6Reason.invoiceAlreadyPaid) {
      console.error('Invoice already paid')
    } else {
      console.error('Debit error:', response.code, response.error)
    }
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
  - While waiting for that receipt, the SDK re-subscribes so a confirmation the relay still has (e.g. after switching to a wallet) is delivered when the page is listening again. A replayed invoice is ignored; only `{ res: "ok" }` (optional `preimage`) counts as the receipt.
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
  - Cancels this instance's active requests, receipt polling, and relisten timers before closing pool connections. Pending promises reject with `AbortError`; already-resolved invoices remain resolved, but their receipt listeners stop.
  - Shutdown is terminal and repeated calls are harmless. Network methods on a stopped instance reject without reconnecting; create a new instance to resume. An injected pool is still destroyed as before.

Standalone `SendNofferRequest`, `SendNdebitRequest`, `SendNmanageRequest`, `SendNenrollRequest`, and `FetchClinkBeacon` accept an optional trailing `AbortSignal` for caller-controlled cancellation. The abort reason is preserved. Cancellation stops SDK activity; it does not undo a request that the host may already have accepted.


### Encoding/Decoding
- `nofferEncode(offer: OfferPointer): string`
- `ndebitEncode(debit: DebitPointer): string`
- `nmanageEncode(manage: ManagePointer): string`
- `decodeBech32(nip19: string): DecodeResult`
- `generateK1(): string` — 32-byte session identifier as lowercase hex (ndebit TLV `3`)
- `validateK1(k1: unknown): string` — throws unless `k1` is 64 lowercase hex chars; returns it unchanged
- `gfy6Reason` — GFY code 6 `reason` tokens (`k1_already_processed`, `invoice_in_progress`, `invoice_already_failed`, `invoice_already_paid`)
- `isNofferReceipt(parsed: unknown): parsed is NofferReceipt` — `{ res: "ok" }` with optional 64-char hex `preimage`

### Validators

For validating inbound/outbound CLINK payloads (e.g. server-side request checks). Each throws on invalid input and returns the typed value on success:

- `validateNofferData`, `validateNdebitData`, `validateK1`, `validateBudgetFrequency`
- `validateNmanageRequest` and per-action helpers: `validateNmanageCreateOffer`, `validateNmanageUpdateOffer`, `validateNmanageDeleteOffer`, `validateNmanageGetOffer`, `validateNmanageListOffers`, `validateOfferFields`

`validateNofferData`, `validateNdebitData`, and `validateBudgetFrequency` return detached, normalized objects rather than the original input. They read recognized values once, omit undefined optional fields and unknown top-level fields, and copy nested payer-data or frequency values. Offer and debit sending serialize this validated payload, not caller-defined `toJSON()` output.

When publishing to multiple relays, one rejection does not abort another relay's accepted request. Publication fails only when all attempts fail; an empty relay list is rejected. A timeout or publication error is not proof that the host did not act, so callers must not blindly retry payments.

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
- **`NofferPayerData`**: `Record<string, string | number> & { quantity?: number }` - runtime validation permits numbers only for the exact `quantity` key, as positive safe integers
- **`NofferData`**: `{ offer: string, amount_sats?: number, description?: string, expires_in_seconds?: number, zap?: string, payer_data?: NofferPayerData }`
- **`NofferError`**: `{ code: number, error: string, range?: { min: number, max: number }, latest?: string, payer_data?: string[] }` - code `6` can list required payer-data keys for discovery and retry
- **`NofferResponse`**: `{ bolt11: string } | NofferError`
- **`NofferReceipt`**: `{ res: 'ok', preimage?: string }` — Lightning receipts include `preimage`; internal settlement omits it
- **`NdebitData`**: `{ pointer?: string, amount_sats?: number, bolt11?: string, frequency?: BudgetFrequency, k1?: string, description?: string }`
- **`NdebitResponse`**: `{ res: 'ok', preimage?: string } | { res: 'GFY', error: string, code: number, reason?: Gfy6Reason, delta?: { max_delta_ms: number, actual_delta_ms: number }, retry_after?: number, range?: { min: number, max: number } }`
- **`OfferPointer`**: `{ pubkey: string, relay: string, offer: string, priceType: OfferPriceType, price?: number, currency?: string }`
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
