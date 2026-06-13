import { NextRequest, NextResponse } from "next/server"
import {
  InvalidNotesCursorError,
  getNotes,
  getNotesPage,
  getNote,
  getTrashNotes,
  getTagSummaries,
  createNote,
  updateNote,
  reorderNotes,
  deleteNote,
  restoreNote,
  emptyTrash,
  initializeWithSampleData,
} from "@/lib/notes-store"
import { getUserIdFromRequest } from "@/lib/user-store"
import { badRequest, ensureCsrf, parseJsonBody, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { createNoteSchema, reorderNotesSchema, updateNoteSchema } from "@/lib/request-validation"
import { NoteWriteConflictError } from "@/lib/note-conflict"

export const runtime = "nodejs"

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

function parseOptionalPositiveInteger(value: string | null, field: string): number | undefined | NextResponse {
  if (value === null || value === "") return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return badRequest(`${field} 必须是正整数`)
  return parsed
}

function parseOptionalBoolean(value: string | null, field: string): boolean | undefined | NextResponse {
  if (value === null || value === "") return undefined
  if (value === "true") return true
  if (value === "false") return false
  return badRequest(`${field} 必须是 true 或 false`)
}

export async function GET(request: NextRequest) {
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId
    await initializeWithSampleData(userId)

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    const notebook = searchParams.get("notebook")
    const type = searchParams.get("type")

    if (type === "tags") {
      const tags = await getTagSummaries(userId)
      return NextResponse.json(tags)
    }

    if (type === "trash") {
      const trash = await getTrashNotes(userId)
      return NextResponse.json(trash)
    }

    if (id) {
      const note = await getNote(userId, id)
      if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json(note)
    }

    if (searchParams.get("page") === "true") {
      const limit = parseOptionalPositiveInteger(searchParams.get("limit"), "limit")
      if (limit instanceof NextResponse) return limit
      const starred = parseOptionalBoolean(searchParams.get("starred"), "starred")
      if (starred instanceof NextResponse) return starred

      try {
        const notes = await getNotesPage(userId, {
          notebook: notebook ?? undefined,
          q: searchParams.get("q") ?? undefined,
          tag: searchParams.get("tag") ?? undefined,
          date: searchParams.get("date") ?? undefined,
          starred,
          cursor: searchParams.get("cursor") ?? undefined,
          limit,
        })
        return NextResponse.json(notes)
      } catch (error) {
        if (error instanceof InvalidNotesCursorError) return badRequest(error.message)
        throw error
      }
    }

    const notes = await getNotes(userId, notebook ?? undefined)
    return NextResponse.json(notes)
  })
}

export async function POST(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId

    const { searchParams } = new URL(request.url)
    const action = searchParams.get("action")

    if (action === "restore") {
      const id = searchParams.get("id")
      if (!id) return badRequest("缺少笔记 ID")
      const baseVersion = parseBaseVersion(searchParams.get("baseVersion"))
      if (baseVersion instanceof NextResponse) return baseVersion
      let note
      try {
        note = await restoreNote(userId, id, baseVersion)
      } catch (error) {
        if (error instanceof NoteWriteConflictError) return conflictResponse(error)
        throw error
      }
      if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json(note)
    }

    if (action === "emptyTrash") {
      const count = await emptyTrash(userId)
      return NextResponse.json({ deleted: count })
    }

    if (action === "reorder") {
      const parsed = await parseJsonBody(request, reorderNotesSchema)
      if ("response" in parsed) return parsed.response

      const notes = await reorderNotes(userId, parsed.data.noteIds)
      return NextResponse.json({ notes })
    }

    const parsed = await parseJsonBody(request, createNoteSchema)
    if ("response" in parsed) return parsed.response

    const note = await createNote(userId, parsed.data)
    return NextResponse.json(note, { status: 201 })
  })
}

export async function PUT(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return badRequest("缺少笔记 ID")

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
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(note)
  })
}

export async function DELETE(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return badRequest("缺少笔记 ID")
    const baseVersion = parseBaseVersion(searchParams.get("baseVersion"))
    if (baseVersion instanceof NextResponse) return baseVersion

    let ok
    try {
      ok = await deleteNote(userId, id, baseVersion)
    } catch (error) {
      if (error instanceof NoteWriteConflictError) return conflictResponse(error)
      throw error
    }
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  })
}
