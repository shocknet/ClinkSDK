import type { NofferData, NofferError, NofferPayerData, NofferResponse } from '../../build/index.js'

const payerData: NofferPayerData = { name: 'Alice', quantity: 2 }
const request: NofferData = { offer: 'o', payer_data: payerData }
const legacyRequest: NofferData = { offer: 'o', payer_data: { name: 'Alice' } }
const discovery: NofferError = { code: 6, error: 'Missing payer data', payer_data: ['name', 'quantity'] }
const response: NofferResponse = discovery
const requiredKeys: string[] | undefined = discovery.payer_data

// @ts-expect-error Quantity must be numeric, not a string.
const invalidPayerData: NofferPayerData = { quantity: '2' }
// @ts-expect-error The request must use the quantity-aware payer-data type.
const invalidRequest: NofferData = { offer: 'o', payer_data: { quantity: '2' } }
// @ts-expect-error Error payer_data lists keys, not request values.
const invalidError: NofferError = { code: 6, error: 'Missing payer data', payer_data: { name: 'Alice' } }
