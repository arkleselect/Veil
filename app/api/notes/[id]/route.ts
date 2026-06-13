import { NextRequest, NextResponse } from "next/server"
import { getNote, updateNote, deleteNote } from "@/lib/notes-store"
import { getUserIdFromRequest } from "@/lib/user-store"
import { badRequest, ensureCsrf, parseJsonBody, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { updateNoteSchema } from "@/lib/request-validation"
import { NoteWriteConflictError } from "@/lib/note-conflict"

export const runtime = "nodejs"

interface RouteContext {
  params: Promise<{ id: string }>
}

async function requireAuth(request: NextRequest): Promise<string | NextResponse> {
  const userId = await getUserIdFromRequest(request)
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 })
  return userId
}

function parseBaseVersion(value: string | null): number | undefined | NextResponse {
  if (value === null) return undefined
  const version = Number(value)
  if (!Number.isInteger(version) || version <= 0) return badRequest("baseVersion 必须是正整数")
  return version
}

function conflictResponse(error: NoteWriteConflictError) {
  return NextResponse.json(
    { error: error.message, current: error.current },
    { status: 409 },
  )
}

export async function GET(request: NextRequest, context: RouteContext) {
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId
    const { id } = await context.params
    const note = await getNote(userId, id)
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 })
    return NextResponse.json(note)
  })
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId
    const { id } = await context.params
    const parsed = await parseJsonBody(request, updateNoteSchema)
    if ("response" in parsed) return parsed.response
    if (parsed.data.baseVersion === undefined) return badRequest("缺少 baseVersion")

    let note
    try {
      note = await updateNote(userId, id, parsed.data)
    } catch (error) {
      if (error instanceof NoteWriteConflictError) return conflictResponse(error)
      throw error
    }
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 })
    return NextResponse.json(note)
  })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId
    const { id } = await context.params
    const baseVersion = parseBaseVersion(new URL(request.url).searchParams.get("baseVersion"))
    if (baseVersion instanceof NextResponse) return baseVersion
    let deleted
    try {
      deleted = await deleteNote(userId, id, baseVersion)
    } catch (error) {
      if (error instanceof NoteWriteConflictError) return conflictResponse(error)
      throw error
    }
    if (!deleted) return NextResponse.json({ error: "Note not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  })
}
