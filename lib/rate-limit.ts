import { withTransaction } from "@/lib/db"

const buckets = new Map<string, { count: number; resetAt: number }>()
let lastPrunedAt = 0

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number }

function pruneExpiredBuckets(now: number) {
  if (now - lastPrunedAt < 60 * 1000) return
  lastPrunedAt = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9@._:-]/g, "_").slice(0, 160) || "unknown"
}

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now()
  pruneExpiredBuckets(now)
  const current = buckets.get(key)
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs })
    return { ok: true }
  }

  if (current.count >= options.limit) {
    return { ok: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) }
  }

  current.count += 1
  return { ok: true }
}

export function rateLimitKey(request: Request, scope: string, subject?: string): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const realIp = request.headers.get("x-real-ip")
  const ip = normalizeKeyPart(forwardedFor || realIp || "unknown")
  return subject ? `${scope}:${ip}:${normalizeKeyPart(subject)}` : `${scope}:${ip}`
}

export async function checkSharedRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const limit = Math.max(1, Math.floor(options.limit))
  const windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1000))
  const maxStoredCount = limit + 1

  return withTransaction(async (client) => {
    await client.query("DELETE FROM rate_limit_buckets WHERE reset_at <= NOW() - INTERVAL '5 minutes'")
    const result = await client.query<{ count: number | string; reset_at: Date | string }>(
      `
        INSERT INTO rate_limit_buckets (bucket_key, count, reset_at, updated_at)
        VALUES ($1, 1, NOW() + ($2::int * INTERVAL '1 second'), NOW())
        ON CONFLICT (bucket_key) DO UPDATE
        SET
          count = CASE
            WHEN rate_limit_buckets.reset_at <= NOW() THEN 1
            ELSE LEAST(rate_limit_buckets.count + 1, $3::int)
          END,
          reset_at = CASE
            WHEN rate_limit_buckets.reset_at <= NOW()
              THEN NOW() + ($2::int * INTERVAL '1 second')
            ELSE rate_limit_buckets.reset_at
          END,
          updated_at = NOW()
        RETURNING count, reset_at
      `,
      [key, windowSeconds, maxStoredCount],
    )

    const row = result.rows[0]
    const count = Number(row.count)
    if (count > limit) {
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000)),
      }
    }

    return { ok: true }
  })
}
