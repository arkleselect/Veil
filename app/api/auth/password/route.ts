import { NextRequest, NextResponse } from "next/server"
import {
  ensureCsrf,
  parseJsonBody,
  setSessionCookies,
  tooManyRequests,
  withDatabaseUnavailableFallback,
} from "@/lib/api-route"
import { checkSharedRateLimit, rateLimitKey } from "@/lib/rate-limit"
import { changePasswordSchema } from "@/lib/request-validation"
import { authRequestMetadata, changePassword, getSessionFromRequest, LOCAL_DESKTOP_USER_ID } from "@/lib/user-store"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError

  const parsed = await parseJsonBody(request, changePasswordSchema)
  if ("response" in parsed) return parsed.response

  return withDatabaseUnavailableFallback(async () => {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }
    if (session.id === LOCAL_DESKTOP_USER_ID) {
      return NextResponse.json({ error: "本地仓库不支持修改密码" }, { status: 403 })
    }

    const limited = await checkSharedRateLimit(rateLimitKey(request, "auth:password"), {
      limit: 10,
      windowMs: 60 * 1000,
    })
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter)
    }

    const userLimited = await checkSharedRateLimit(rateLimitKey(request, "auth:password:user", session.id), {
      limit: 5,
      windowMs: 5 * 60 * 1000,
    })
    if (!userLimited.ok) {
      return tooManyRequests(userLimited.retryAfter)
    }

    const result = await changePassword(
      session.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      authRequestMetadata(request),
    )
    if (!result.ok || !result.user) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const response = NextResponse.json({ ok: true })
    setSessionCookies(response, result.user.token)
    return response
  })
}
