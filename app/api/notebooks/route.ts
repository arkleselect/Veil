import { NextRequest, NextResponse } from "next/server"
import { getNotebooks, createNotebook, updateNotebook, deleteNotebook, getFavorites, initializeWithSampleData } from "@/lib/notes-store"
import { getUserIdFromRequest } from "@/lib/user-store"
import type { Note } from "@/lib/notes-data"
import { badRequest, ensureCsrf, parseJsonBody, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { createNotebookSchema, updateNotebookSchema } from "@/lib/request-validation"

export const runtime = "nodejs"

async function requireAuth(request: NextRequest): Promise<string | NextResponse> {
  const userId = await getUserIdFromRequest(request)
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 })
  return userId
}

export async function GET(request: NextRequest) {
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId
    await initializeWithSampleData(userId)

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")

    if (type === "favorites") {
      const favorites: Note[] = await getFavorites(userId)
      return NextResponse.json(favorites)
    }

    const notebooks = await getNotebooks(userId)
    return NextResponse.json(notebooks)
  })
}

export async function POST(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId
    const parsed = await parseJsonBody(request, createNotebookSchema)
    if ("response" in parsed) return parsed.response

    const notebook = await createNotebook(userId, parsed.data)
    return NextResponse.json(notebook, { status: 201 })
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
    if (!id) return badRequest("缺少笔记本 ID")
    const parsed = await parseJsonBody(request, updateNotebookSchema)
    if ("response" in parsed) return parsed.response

    const notebook = await updateNotebook(userId, id, parsed.data)
    if (!notebook) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(notebook)
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
    if (!id) return badRequest("缺少笔记本 ID")
    const ok = await deleteNotebook(userId, id)
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  })
}
