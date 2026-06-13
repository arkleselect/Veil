import { describe, expect, it } from "vitest"
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit"

describe("rate-limit", () => {
  it("blocks requests after the configured limit", () => {
    const key = `test:${crypto.randomUUID()}`

    expect(checkRateLimit(key, { limit: 2, windowMs: 60_000 })).toEqual({ ok: true })
    expect(checkRateLimit(key, { limit: 2, windowMs: 60_000 })).toEqual({ ok: true })
    expect(checkRateLimit(key, { limit: 2, windowMs: 60_000 })).toMatchObject({
      ok: false,
      retryAfter: expect.any(Number),
    })
  })

  it("builds normalized keys from IP and subject", () => {
    const request = new Request("https://notes.example.com/api/auth/login", {
      headers: {
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      },
    })

    expect(rateLimitKey(request, "auth:login:user", " Alice Smith! ")).toBe(
      "auth:login:user:203.0.113.9:alice_smith_",
    )
  })
})
