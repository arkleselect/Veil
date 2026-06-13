import { NextRequest, NextResponse } from "next/server"
import { clearSessionCookies, ensureCsrf, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { getSessionFromRequest, revokeToken } from "@/lib/user-store"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError

  return withDatabaseUnavailableFallback(async () => {
    const session = await getSessionFromRequest(request)
    if (session) {
      await revokeToken(session.token)
    }

    const response = NextResponse.json({ ok: true })
    clearSessionCookies(response)
    return response
  })
}
