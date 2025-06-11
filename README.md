# @shocknet/clink-sdk

**A TypeScript/JavaScript SDK for the CLINK protocol — Nostr-native static Lightning payment offers and debits.**

---

## Overview

`@shocknet/clink-sdk` provides a simple, robust interface for working with [CLINK](https://github.com/shocknet/CLINK/) (`noffer1...` and `ndebit1...`) on Nostr. It enables applications and wallets to create, encode, decode, send, and receive CLINK payment requests and authorizations using Nostr relays, with full support for NIP-44 encryption and the CLINK protocol.

- **No web server or Onion Messaging required:** Unlike LNURL and Bolt12, all communication is over Nostr relays.
- **Compatible with [Lightning.Pub](https://github.com/shocknet/Lightning.Pub), [ShockWallet](https://shockwallet.app), and other CLINK-enabled apps.**
- **Implements the official [CLINK protocol](https://github.com/shocknet/CLINK).**

---

## Features

- Encode/decode CLINK Static Offers (`noffer1...`) and Debits (`ndebit1...`) per the spec.
- Send and receive CLINK payment requests (kind 21001) and debit requests (kind 21002) over Nostr.
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

---

## Usage

### 1. Encoding/Decoding Offers and Debits

```ts
import { nofferEncode, ndebitEncode, decodeBech32, OfferPriceType } from '@shocknet/clink-sdk';

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
```

### 2. Sending a CLINK Offer Request (Lightning Invoice)

```ts
import { ClinkSDK, NofferData } from '@shocknet/clink-sdk';
import { generatePrivateKey } from 'nostr-tools';

const sdk = new ClinkSDK({
  privateKey: generatePrivateKey(), // Uint8Array
  relays: ['wss://relay.example.com'],
  toPubKey: '<receiver_pubkey_hex>',
});

const request: NofferData = {
  offer: 'my_offer_id',
  amount: 1000, // sats
  payer_data: { name: 'Alice' },
};

sdk.Noffer(request).then(response => {
  if ('bolt11' in response) {
    console.log('Invoice:', response.bolt11);
  } else {
    console.error('Error:', response.error);
  }
});
```

### 3. Sending a CLINK Debit Request

```ts
import { ClinkSDK, NdebitData } from '@shocknet/clink-sdk';
import { generatePrivateKey } from 'nostr-tools';

const sdk = new ClinkSDK({
  privateKey: generatePrivateKey(),
  relays: ['wss://relay.example.com'],
  toPubKey: '<wallet_service_pubkey_hex>',
});

const request: NdebitData = {
  pointer: 'my_pointer_id',
  amount_sats: 5000,
  bolt11: '<BOLT11_invoice_string>',
};

sdk.Ndebit(request).then(response => {
  if (response.res === 'ok' && 'preimage' in response) {
    console.log('Payment preimage:', response.preimage);
  } else if (response.res === 'GFY') {
    console.error('Debit error:', response.error);
  }
});
```

---

## API Reference

### ClinkSDK

```ts
new ClinkSDK(settings: ClinkSettings, pool?: AbstractSimplePool)
```
- `settings`: `{ privateKey: Uint8Array, relays: string[], toPubKey: string, defaultTimeoutSeconds?: number }`
- `pool`: Optional, pass a custom Nostr pool (defaults to `SimplePool` from nostr-tools).

#### Methods
- `Noffer(data: NofferData, timeoutSeconds?: number): Promise<NofferResponse>`
- `Ndebit(data: NdebitData, timeoutSeconds?: number): Promise<NdebitResponse>`

### Encoding/Decoding
- `nofferEncode(offer: OfferPointer): string`
- `ndebitEncode(debit: DebitPointer): string`
- `decodeBech32(nip19: string): DecodeResult`

### Types
- `NofferData`, `NofferResponse`, `OfferPointer`, `OfferPriceType`
- `NdebitData`, `NdebitResponse`, `DebitPointer`, `BudgetFrequency`

---

## Protocol

- [CLINK Protocol Overview](https://github.com/shocknet/CLINK)

---

## License

ISC 