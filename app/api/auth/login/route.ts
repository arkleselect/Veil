import { NextRequest, NextResponse } from "next/server"
import { authRequestMetadata, loginUser } from "@/lib/user-store"
import {
  ensureTrustedOrigin,
  parseJsonBody,
  setSessionCookies,
  tooManyRequests,
  withDatabaseUnavailableFallback,
} from "@/lib/api-route"
import { loginSchema } from "@/lib/request-validation"
import { checkSharedRateLimit, rateLimitKey } from "@/lib/rate-limit"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const originError = ensureTrustedOrigin(request)
  if (originError) return originError

  const limited = await withDatabaseUnavailableFallback(() =>
    checkSharedRateLimit(rateLimitKey(request, "auth:login"), {
      limit: 20,
      windowMs: 60 * 1000,
    }),
  )
  if (limited instanceof NextResponse) return limited
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfter)
  }

  const parsed = await parseJsonBody(request, loginSchema)
  if ("response" in parsed) return parsed.response

  const { username, password } = parsed.data
  const userLimited = await withDatabaseUnavailableFallback(() =>
    checkSharedRateLimit(rateLimitKey(request, "auth:login:user", username), {
      limit: 8,
      windowMs: 5 * 60 * 1000,
    }),
  )
  if (userLimited instanceof NextResponse) return userLimited
  if (!userLimited.ok) {
    return tooManyRequests(userLimited.retryAfter)
  }

  const result = await withDatabaseUnavailableFallback(async () => {
    const authResult = await loginUser(username, password, authRequestMetadata(request))
    if (!authResult.ok || !authResult.user) {
      return NextResponse.json(
        { error: authResult.error },
        {
          status: authResult.status ?? 401,
          ...(authResult.retryAfter
            ? { headers: { "Retry-After": String(authResult.retryAfter) } }
            : {}),
        },
      )
    }

    const user = authResult.user
    const response = NextResponse.json({
      id: user.id,
      username: user.username,
    })
    setSessionCookies(response, user.token)
    return response
  })
  return result
}
