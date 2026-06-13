import { NextRequest, NextResponse } from "next/server"
import { badRequest, ensureCsrf, tooManyRequests, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { checkSharedRateLimit, rateLimitKey } from "@/lib/rate-limit"
import {
  authRequestMetadata,
  getSessionFromRequest,
  listUserSessions,
  LOCAL_DESKTOP_USER_ID,
  revokeOtherUserSessions,
  revokeUserSession,
} from "@/lib/user-store"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  return withDatabaseUnavailableFallback(async () => {
    const session = await getSessionFromRequest(request)
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 })
    if (session.id === LOCAL_DESKTOP_USER_ID) {
      return NextResponse.json({ sessions: [] })
    }

    const sessions = await listUserSessions(session.id, session.sessionId)
    return NextResponse.json({ sessions })
  })
}

export async function DELETE(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError

  return withDatabaseUnavailableFallback(async () => {
    const session = await getSessionFromRequest(request)
    if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 })
    if (session.id === LOCAL_DESKTOP_USER_ID) {
      return NextResponse.json({ error: "本地仓库不支持会话管理" }, { status: 403 })
    }

    const limited = await checkSharedRateLimit(rateLimitKey(request, "auth:sessions", session.id), {
      limit: 20,
      windowMs: 60 * 1000,
    })
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter)
    }

    const { searchParams } = new URL(request.url)
    if (searchParams.get("scope") === "others") {
      const revoked = await revokeOtherUserSessions(
        session.id,
        session.sessionId,
        authRequestMetadata(request),
      )
      return NextResponse.json({ revoked })
    }

    const id = searchParams.get("id")
    if (!id) return badRequest("缺少会话 ID")

    const result = await revokeUserSession(
      session.id,
      id,
      session.sessionId,
      authRequestMetadata(request),
    )
    if (result.current) {
      return NextResponse.json({ error: "不能撤销当前会话，请使用退出登录" }, { status: 400 })
    }
    if (!result.revoked) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ revoked: 1 })
  })
}
