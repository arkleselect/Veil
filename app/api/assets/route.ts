import { NextRequest, NextResponse } from "next/server"
import { createAssetFromFile, listAssets, AssetUploadError } from "@/lib/assets-store"
import { badRequest, ensureCsrf, withDatabaseUnavailableFallback } from "@/lib/api-route"
import { getUserIdFromRequest } from "@/lib/user-store"

export const runtime = "nodejs"

async function requireAuth(request: NextRequest): Promise<string | NextResponse> {
  const userId = await getUserIdFromRequest(request)
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 })
  return userId
}

function parseOptionalPositiveInteger(value: string | null, field: string): number | undefined | NextResponse {
  if (value === null || value === "") return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return badRequest(`${field} 必须是正整数`)
  return parsed
}

export async function GET(request: NextRequest) {
  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId

    const { searchParams } = new URL(request.url)
    const limit = parseOptionalPositiveInteger(searchParams.get("limit"), "limit")
    if (limit instanceof NextResponse) return limit

    const result = await listAssets(userId, limit)
    return NextResponse.json(result)
  })
}

export async function POST(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError

  return withDatabaseUnavailableFallback(async () => {
    const userId = await requireAuth(request)
    if (typeof userId !== "string") return userId

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return badRequest("请求体必须是 multipart/form-data")
    }

    const file = form.get("file")
    if (!(file instanceof File)) return badRequest("缺少文件")

    try {
      const asset = await createAssetFromFile(userId, file)
      return NextResponse.json(asset, { status: 201 })
    } catch (error) {
      if (error instanceof AssetUploadError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      throw error
    }
  })
}
