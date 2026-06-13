import crypto from "crypto"

interface PublicSharePayload {
  v: 1
  userId: string
  noteId: string
}

function shareSecret(): string {
  return (
    process.env.VEIL_SHARE_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.DATABASE_URL ||
    "veil-public-share-development-secret"
  )
}

function encodePayload(payload: PublicSharePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function signPayload(encodedPayload: string): string {
  return crypto
    .createHmac("sha256", shareSecret())
    .update(encodedPayload)
    .digest("base64url")
}

export function createPublicNoteShareToken(userId: string, noteId: string): string {
  const payload = encodePayload({ v: 1, userId, noteId })
  return `${payload}.${signPayload(payload)}`
}

export function verifyPublicNoteShareToken(token: string): { userId: string; noteId: string } | null {
  const [payload, signature] = token.split(".")
  if (!payload || !signature) return null

  const expected = signPayload(payload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length) return null
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PublicSharePayload>
    if (parsed.v !== 1 || !parsed.userId || !parsed.noteId) return null
    return { userId: parsed.userId, noteId: parsed.noteId }
  } catch {
    return null
  }
}
