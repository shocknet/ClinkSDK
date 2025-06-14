import { nip44, getPublicKey, finalizeEvent } from "nostr-tools"
import { AbstractSimplePool, SubCloser } from "nostr-tools/lib/types/pool"
const { getConversationKey, decrypt, encrypt } = nip44

// --- Request Types ---

export type CreateOfferPayload = {
  label?: string;
  price_sats: number;
  callback_url?: string;
  payer_data?: string[];
}

export type UpdateOfferPayload = {
  id: string;
  fields: Partial<Omit<CreateOfferPayload, 'id'>>;
}

export type DeleteOfferPayload = {
  id: string;
}

export type ManageRequest = {
  resource: 'offer';
  action: 'create';
  offer: CreateOfferPayload;
} | {
  resource: 'offer';
  action: 'update';
  offer: UpdateOfferPayload;
} | {
  resource: 'offer';
  action: 'delete';
  offer: DeleteOfferPayload;
};


// --- Response Types ---

export type OfferDetails = {
  id: string;
  label: string;
  price_sats: number;
  callback_url: string;
  payer_data: string[];
  noffer: string;
}

export type ManageSuccessResponse = {
  res: 'ok';
  resource: 'offer';
  details: OfferDetails;
}

export type ManageGFYResponse = {
  res: 'GFY';
  code: number;
  error: string;
  [key: string]: any; // For additional GFY fields
}

export type ManageResponse = ManageSuccessResponse | ManageGFYResponse;

// --- Sender Function ---

export const sendManageRequest = async (
    pool: AbstractSimplePool,
    privateKey: Uint8Array,
    toPubKey: string, // wallet server pubkey
    request: ManageRequest,
    relays: string[],
    timeoutSeconds = 30
): Promise<ManageResponse> => {
    const publicKey = getPublicKey(privateKey);
    const conversationKey = getConversationKey(privateKey, toPubKey);
    const content = encrypt(JSON.stringify(request), conversationKey);

    const event = {
        kind: 21003,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: publicKey,
        tags: [
            ['p', toPubKey],
            ['clink_version', '1']
        ],
        content: content,
    };

    const signedEvent = finalizeEvent(event, privateKey);
    await Promise.all(pool.publish(relays, signedEvent));

    return new Promise<ManageResponse>((resolve, reject) => {
        let closer: SubCloser;
        const timeout = setTimeout(() => {
            if (closer) closer.close();
            reject(new Error(`Request timed out after ${timeoutSeconds} seconds`));
        }, timeoutSeconds * 1000);

        const filter = {
            authors: [toPubKey],
            kinds: [21003],
            '#p': [publicKey],
            '#e': [signedEvent.id],
            since: Math.floor(Date.now() / 1000) - 1,
        };

        closer = pool.subscribeMany(relays, [filter], {
            onevent: (e) => {
                clearTimeout(timeout);
                try {
                    const decryptedContent = decrypt(e.content, conversationKey);
                    const response = JSON.parse(decryptedContent) as ManageResponse;
                    resolve(response);
                } catch (err) {
                    reject(new Error(`Failed to decrypt or parse response: ${err}`));
                }
            },
            onclose: () => {
                reject(new Error("Subscription closed before response was received."));
            }
        });
    });
} 