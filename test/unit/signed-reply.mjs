import { finalizeEvent, nip44 } from 'nostr-tools'

const { getConversationKey, encrypt } = nip44

export const signedClinkReply = (serverPriv, clientPub, requestId, payload, kind, extra = {}) => {
  const tags = [
    ['p', extra.p ?? clientPub],
    ['e', extra.e ?? requestId],
  ]
  if (!extra.omitClinkVersion) {
    tags.push(['clink_version', extra.clinkVersion ?? '1'])
  }
  if (extra.extraTags) {
    tags.push(...extra.extraTags)
  }
  return finalizeEvent({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: extra.content ?? encrypt(JSON.stringify(payload), getConversationKey(serverPriv, clientPub)),
  }, serverPriv)
}
