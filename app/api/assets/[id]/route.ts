import fs from "fs/promises"
import { NextRequest, NextResponse } from "next/server"
import { AssetDeleteError, deleteAsset, getAssetFile } from "@/lib/assets-store"
import { ensureCsrf, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { getUserIdFromRequest, LOCAL_DESKTOP_USER_ID } from "@/lib/user-store"

export const runtime = "nodejs"

interface RouteContext {
  params: Promise<{ id: string }>
}

async function requireAssetUser(request: NextRequest): Promise<string | NextResponse> {
  const userId = await getUserIdFromRequest(request)
  if (userId) return userId
  if (process.env.VEIL_DESKTOP_RUNTIME === "1") return LOCAL_DESKTOP_USER_ID
  return NextResponse.json({ error: "未登录" }, { status: 401 })
}

async function requireAuth(request: NextRequest): Promise<string | NextResponse> {
  const userId = await getUserIdFromRequest(request)
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 })
  return userId
}

function contentDisposition(filename: string, contentType: string): string | undefined {
  if (contentType.startsWith("image/")) return undefined
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(request: NextRequest, context: RouteContext) {
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAssetUser(request)
    if (typeof userId !== "string") return userId

    const { id } = await context.params
    const asset = await getAssetFile(userId, id)
    if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let bytes: Buffer
    try {
      bytes = await fs.readFile(asset.absolutePath)
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      throw error
    }

    const disposition = contentDisposition(asset.filename, asset.contentType)
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable",
        ...(disposition ? { "Content-Disposition": disposition } : {}),
      },
    })
  })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError

  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId

    const { id } = await context.params
    const force = request.nextUrl.searchParams.get("force") === "true"
    let deleted: boolean
    try {
      deleted = await deleteAsset(userId, id, { force })
    } catch (error) {
      if (error instanceof AssetDeleteError) {
        return NextResponse.json(
          { error: error.message, referenceCount: error.referenceCount },
          { status: error.status },
        )
      }
      throw error
    }
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  })
}
