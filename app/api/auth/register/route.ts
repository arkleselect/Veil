import { NextRequest, NextResponse } from "next/server"
import { authRequestMetadata, registerUser } from "@/lib/user-store"
import {
  ensureTrustedOrigin,
  parseJsonBody,
  setSessionCookies,
  tooManyRequests,
  withDatabaseUnavailableFallback,
} from "@/lib/api-route"
import { registerSchema } from "@/lib/request-validation"
import { checkSharedRateLimit, rateLimitKey } from "@/lib/rate-limit"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const originError = ensureTrustedOrigin(request)
  if (originError) return originError

  if (process.env.NODE_ENV === "production" && process.env.VEIL_ALLOW_REGISTRATION !== "true") {
    return NextResponse.json({ error: "注册暂未开放，请联系管理员创建账号" }, { status: 403 })
  }

  const limited = await withDatabaseUnavailableFallback(() =>
    checkSharedRateLimit(rateLimitKey(request, "auth:register"), {
      limit: 10,
      windowMs: 60 * 1000,
    }),
  )
  if (limited instanceof NextResponse) return limited
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfter)
  }

  const parsed = await parseJsonBody(request, registerSchema)
  if ("response" in parsed) return parsed.response

  const { username, password } = parsed.data
  const userLimited = await withDatabaseUnavailableFallback(() =>
    checkSharedRateLimit(rateLimitKey(request, "auth:register:user", username), {
      limit: 5,
      windowMs: 10 * 60 * 1000,
    }),
  )
  if (userLimited instanceof NextResponse) return userLimited
  if (!userLimited.ok) {
    return tooManyRequests(userLimited.retryAfter)
  }

  const result = await withDatabaseUnavailableFallback(async () => {
    const authResult = await registerUser(username, password, authRequestMetadata(request))
    if (!authResult.ok || !authResult.user) {
      return NextResponse.json({ error: authResult.error }, { status: 400 })
    }

    const user = authResult.user
    const response = NextResponse.json({
      id: user.id,
      username: user.username,
    }, { status: 201 })
    setSessionCookies(response, user.token)
    return response
  })
  return result
}
