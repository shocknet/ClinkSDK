import { nip44, finalizeEvent, UnsignedEvent, Relay, Filter, generateSecretKey, getPublicKey } from "nostr-tools"
import { ClinkSDK, decodeBech32, NofferData, nofferEncode, OfferPointer, OfferPriceType, validateNofferData } from "./index.js"


const MOCK_OFFER_INVOICE = "MOCK_OFFER_INVOICE"

type Pair = { privateKey: Uint8Array, publicKey: string }

const connectRelay = async (pair: Pair, relayUrl: string, onReady: () => void) => {
    console.log("connecting to relay", relayUrl)
    const { privateKey, publicKey } = pair
    const kind = 21001
    const relay = await Relay.connect(relayUrl)
    if (!relay.connected) {
        throw new Error("failed to connect to relay")
    }
    relay.onclose = () => {
        console.log("relay disconnected")
    }
    const filter: Filter = {
        since: Math.ceil(Date.now() / 1000),
        kinds: [kind],
        '#p': [publicKey],
    }
    relay.subscribe([filter], {
        oneose: () => {
            onReady()
        },
        onevent: (e) => {
            const convKey = nip44.getConversationKey(pair.privateKey, e.pubkey)
            const content = nip44.decrypt(e.content, convKey)
            const data = JSON.parse(content) as NofferData
            try {
                validateNofferData(data)
            } catch (e) {
                console.error("failed to validate noffer data", content)
                return
            }
            console.log("processing noffer request:", data.offer)
            const contentRes = JSON.stringify({ bolt11: MOCK_OFFER_INVOICE })
            const encryptedRes = nip44.encrypt(contentRes, convKey)
            const res = newNofferResponse(encryptedRes, { id: e.id, pub: e.pubkey })
            const finalized = finalizeEvent(res, privateKey)
            relay.publish(finalized)
                .then(() => console.log("published response event"))
                .catch((e) => console.error("failed to publish response event", e))
        }
    })
    return relay
}
const newNofferResponse = (content: string, event: { id: string, pub: string }): UnsignedEvent => {
    return {
        content,
        created_at: Math.floor(Date.now() / 1000),
        kind: 21001,
        pubkey: "",
        tags: [
            ['p', event.pub],
            ['e', event.id],
        ],
    }
}
const RELAY_URL = 'wss://relay.lightning.pub'
class MockNofferService {
    pair: Pair
    relay: Relay | null
    constructor() {
        const privateKey = generateSecretKey()
        const publicKey = getPublicKey(privateKey)
        this.pair = { privateKey, publicKey }
    }
    GetNoffer = () => {
        return nofferEncode({
            offer: "mock offer",
            priceType: OfferPriceType.Spontaneous,
            pubkey: this.pair.publicKey,
            relay: RELAY_URL,
        })
    }
    Start = async () => {
        console.log("starting mock noffer service")
        await new Promise(async resolve => {
            this.relay = await connectRelay(this.pair, RELAY_URL, () => resolve(this.relay))
        })
    }

    Stop = async () => {
        if (this.relay) {
            this.relay.close()
        }
    }
}



class E2ETest {
    mockService: MockNofferService
    sdk: ClinkSDK
    userPair: Pair
    offerPointer: OfferPointer
    constructor() {
        const privateKey = generateSecretKey()
        const publicKey = getPublicKey(privateKey)
        this.userPair = { privateKey, publicKey }
        this.mockService = new MockNofferService()
        const noffer = this.mockService.GetNoffer()
        const decoded = decodeBech32(noffer)
        if (decoded.type !== 'noffer') {
            throw new Error("failed to decode noffer")
        }
        this.offerPointer = decoded.data
        this.sdk = new ClinkSDK({
            privateKey: this.userPair.privateKey,
            relays: [this.offerPointer.relay],
            toPubKey: this.offerPointer.pubkey,
        })
    }
    Start = async () => {
        console.log("starting e2e test")
        await this.mockService.Start()
        await this.TestNoffer()
        this.mockService.Stop()
    }
    TestNoffer = async () => {
        console.log("testing noffer")
        const res = await this.sdk.Noffer({
            offer: this.offerPointer.offer,
            amount_sats: 1000,
        })
        if ('bolt11' in res) {
            console.log("got bolt11", res.bolt11)
            if (res.bolt11 !== MOCK_OFFER_INVOICE) {
                throw new Error("bolt11 does not match mock invoice")
            }
        } else {
            throw new Error("failed to get bolt11 from noffer")
        }
        console.log("noffer test passed")

    }
}

new E2ETest().Start()