import { NextRequest, NextResponse } from "next/server"
import { getNote } from "@/lib/notes-store"
import { getUserIdFromRequest } from "@/lib/user-store"
import { badRequest, ensureCsrf, parseJsonBody, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { publicShareSchema } from "@/lib/request-validation"
import { createPublicNoteShareToken } from "@/lib/public-share"

export const runtime = "nodejs"

async function requireAuth(request: NextRequest): Promise<string | NextResponse> {
  const userId = await getUserIdFromRequest(request)
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 })
  return userId
}

export async function POST(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError

  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId

    const parsed = await parseJsonBody(request, publicShareSchema)
    if ("response" in parsed) return parsed.response

    const note = await getNote(userId, parsed.data.noteId)
    if (!note || note.deletedAt) return badRequest("笔记不存在或已被删除")

    const token = createPublicNoteShareToken(userId, note.id)
    const url = new URL(`/share/${encodeURIComponent(token)}`, request.nextUrl.origin)
    return NextResponse.json({ token, url: url.toString() })
  })
}
