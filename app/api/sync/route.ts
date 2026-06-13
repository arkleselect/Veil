import { NextRequest, NextResponse } from "next/server"
import { getSyncPull, applySyncPush, initializeWithSampleData, noteToMarkdown, markdownToNote } from "@/lib/notes-store"
import { getSessionFromRequest } from "@/lib/user-store"
import { ensureCsrf, parseJsonBody, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { syncRequestSchema } from "@/lib/request-validation"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError

  return withDatabaseUnavailableFallback(async () => {
    const user = await getSessionFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: "令牌无效" }, { status: 401 })
    }

    await initializeWithSampleData(user.id)

    const parsed = await parseJsonBody(request, syncRequestSchema)
    if ("response" in parsed) return parsed.response

    const { changes, since } = parsed.data

    let result: { accepted: number; conflicts: string[] } = { accepted: 0, conflicts: [] }
    if (Array.isArray(changes)) {
      result = await applySyncPush(user.id, changes)
    }

    const pulled = await getSyncPull(user.id, since || undefined)

    return NextResponse.json({
      acceptedChanges: result.accepted,
      conflicts: result.conflicts,
      pulledChanges: pulled.map((note) => {
        const markdown = noteToMarkdown(note)
        return {
          id: note.id,
          markdown,
          updatedAt: note.updatedAt,
          version: note.version,
          contentHash: markdownToNote(markdown, note.id).contentHash,
          deleted: Boolean(note.deletedAt),
        }
      }),
      serverTime: new Date().toISOString(),
    })
  })
}
