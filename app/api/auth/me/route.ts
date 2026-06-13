import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/user-store"
import { withDatabaseUnavailableFallback } from "@/lib/api-route"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  return withDatabaseUnavailableFallback(async () => {
    const user = await getSessionFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: "令牌无效" }, { status: 401 })
    }

    return NextResponse.json({ id: user.id, username: user.username })
  })
}
