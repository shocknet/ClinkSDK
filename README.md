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
const receiptCallback = (receipt) => {
  console.log("got receipt", receipt)
}
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
import { ClinkSDK, NdebitData, generateSecretKey } from '@shocknet/clink-sdk';

const sdk = new ClinkSDK({
  privateKey: generateSecretKey(),
  relays: ['wss://relay.example.com'],
  toPubKey: '<wallet_service_pubkey_hex>',
});

// Request the service to pay an invoice
const simplePaymentRequest = newNdebitPaymentRequest('<BOLT11_invoice_string>', 5000, 'my_pointer_id')

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
const fullAccessRequest = newNdebitFullAccessRequest('my_pointer_id')

sdk.Ndebit(fullAccessRequest).then(response => {
  if (response.res === 'ok') {
    console.log('Full access aproved:');
  } else if (response.res === 'GFY') {
    console.error('Full access request failed:', response.error);
  }
});

// Request a budget
const budgetRequest = newNdebitBudgetRequest({ number: 1, unit: 'week' }, 1000, 'my_pointer_id')

sdk.Ndebit(budgetRequest).then(response => {
  if (response.res === 'ok') {
    console.log('Budget aproved:');
  } else if (response.res === 'GFY') {
    console.error('Budget request failed:', response.error);
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
- `Noffer(data: NofferData, onReceipt?: (receipt: NofferReceipt) => void, timeoutSeconds?: number)`
  - Sends a `kind: 21001` offer request.
  - Returns a `Promise<NofferResponse>` that resolves with the invoice or an error.
  - The optional `onReceipt` callback is triggered if the service sends a payment receipt after the invoice is paid.
- `Ndebit(data: NdebitData, timeoutSeconds?: number)`
  - Sends a `kind: 21002` debit request.
  - Returns a `Promise<NdebitResponse>` that resolves with the payment/budget confirmation or an error.
- `Nmanage(data: NmanageRequest, timeoutSeconds?: number)`
  - Sends a `kind: 21003` management request.
  - Returns a `Promise<NmanageResponse>` that resolves with the result of the management action.

### Encoding/Decoding
- `nofferEncode(offer: OfferPointer): string`
- `ndebitEncode(debit: DebitPointer): string`
- `decodeBech32(nip19: string): DecodeResult`

### Types
- **`NofferData`**: `{ offer: string, amount_sats?: number, description?: string, expires_in_seconds?: number, zap?: string, payer_data?: any }`
- **`NofferResponse`**: `{ bolt11: string } | { code: number, error: string, range?: { min: number, max: number } }`
- **`NofferReceipt`**: `{ preimage?: string }`
- **`NdebitData`**: `{ pointer?: string, amount_sats?: number, bolt11?: string, frequency?: BudgetFrequency }`
- **`NdebitResponse`**: `{ res: 'ok', preimage?: string } | { res: 'GFY', error: string, code: number }`
- **`OfferPointer`**: `{ pubkey: string, relay: string, offer: string, priceType: OfferPriceType, price?: number }`
- **`DebitPointer`**: `{ pubkey: string, relay: string, pointer?: string }`
- **`OfferPriceType`**: `enum { Fixed = 0, Variable = 1, Spontaneous = 2 }`
- **`BudgetFrequency`**: `{ number: number, unit: 'day' | 'week' | 'month' }`

---

## Protocol

- [CLINK Protocol Overview](https://github.com/shocknet/CLINK)

---

## License

MIT
