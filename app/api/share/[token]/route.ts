import { NextResponse } from "next/server"
import { getNote, noteToMarkdown } from "@/lib/notes-store"
import { verifyPublicNoteShareToken } from "@/lib/public-share"
import { withDatabaseUnavailableFallback } from "@/lib/api-route"

export const runtime = "nodejs"

interface RouteContext {
  params: Promise<{ token: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  return withDatabaseUnavailableFallback(async () => {
    const { token } = await context.params
    const share = verifyPublicNoteShareToken(decodeURIComponent(token))
    if (!share) return NextResponse.json({ error: "分享链接无效" }, { status: 404 })

    const note = await getNote(share.userId, share.noteId)
    if (!note || note.deletedAt) return NextResponse.json({ error: "分享内容不存在" }, { status: 404 })

    return NextResponse.json({
      note,
      markdown: noteToMarkdown(note),
    })
  })
}
