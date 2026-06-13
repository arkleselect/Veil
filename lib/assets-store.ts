import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { query, withTransaction } from "@/lib/db"
import { getLocalVaultRoot } from "@/lib/local-vault-path"
import { LOCAL_DESKTOP_USER_ID } from "@/lib/user-store"
import type { Asset, AssetList, AssetUsage, StoredAsset } from "@/lib/assets-data"

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const DEFAULT_ASSET_QUOTA_BYTES = 1024 * 1024 * 1024
const DEFAULT_ASSET_LIST_LIMIT = 100
const MAX_ASSET_LIST_LIMIT = 500
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
])
const ALLOWED_ATTACHMENT_TYPES = new Map([
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["text/markdown", ".md"],
  ["text/csv", ".csv"],
  ["application/json", ".json"],
  ["application/zip", ".zip"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
])
const ALLOWED_ASSET_TYPES = new Map([...ALLOWED_IMAGE_TYPES, ...ALLOWED_ATTACHMENT_TYPES])

interface AssetRow {
  id: string
  filename: string
  content_type: string
  size_bytes: number | string
  storage_path: string
  created_at: Date | string
  reference_count?: number | string | null
}

interface AssetUsageRow {
  used_bytes: number | string | null
  asset_count: number | string | null
}

export interface AssetFile extends StoredAsset {
  absolutePath: string
}

export class AssetUploadError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "AssetUploadError"
    this.status = status
  }
}

export class AssetDeleteError extends Error {
  status: number
  referenceCount?: number

  constructor(message: string, status = 400, referenceCount?: number) {
    super(message)
    this.name = "AssetDeleteError"
    this.status = status
    this.referenceCount = referenceCount
  }
}

export function getMaxUploadBytes(): number {
  const configured = Number(process.env.VEIL_MAX_UPLOAD_BYTES)
  if (Number.isInteger(configured) && configured > 0) return configured
  return DEFAULT_MAX_UPLOAD_BYTES
}

export function getAssetQuotaBytes(): number {
  const configured = Number(process.env.VEIL_ASSET_QUOTA_BYTES)
  if (Number.isInteger(configured) && configured > 0) return configured
  return DEFAULT_ASSET_QUOTA_BYTES
}

function getCloudUploadRoot(): string {
  return path.resolve(process.env.VEIL_UPLOAD_DIR?.trim() || path.join(process.cwd(), "uploads"))
}

function safeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || randomUUID()
}

function safeOriginalFilename(value: string): string {
  const basename = path.basename(value || "file")
  const cleaned = basename.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  return cleaned.slice(0, 160) || "file"
}

function normalizeContentType(value: string): string {
  const type = value.split(";")[0]?.trim().toLowerCase() || ""
  return type === "image/jpg" ? "image/jpeg" : type
}

export function detectImageContentType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }

  if (bytes.length >= 6) {
    const header = String.fromCharCode(...bytes.slice(0, 6))
    if (header === "GIF87a" || header === "GIF89a") return "image/gif"
  }

  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4))
    const webp = String.fromCharCode(...bytes.slice(8, 12))
    if (riff === "RIFF" && webp === "WEBP") return "image/webp"
  }

  return null
}

export function detectAttachmentContentType(bytes: Uint8Array): string | null {
  const imageType = detectImageContentType(bytes)
  if (imageType) return imageType

  if (bytes.length >= 5) {
    const header = String.fromCharCode(...bytes.slice(0, 5))
    if (header === "%PDF-") return "application/pdf"
  }

  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/zip"
  }

  const sample = bytes.slice(0, Math.min(bytes.length, 4096))
  const looksText = sample.every((byte) => (
    byte === 0x09 ||
    byte === 0x0a ||
    byte === 0x0d ||
    (byte >= 0x20 && byte !== 0x7f)
  ))
  if (looksText) return "text/plain"

  return null
}

function assetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}`
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function assetFromRow(row: AssetRow): Asset {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    url: assetUrl(row.id),
    createdAt: toIso(row.created_at),
    referenceCount: Number(row.reference_count ?? 0),
  }
}

function storedAssetFromRow(row: AssetRow): StoredAsset {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    storagePath: row.storage_path,
    createdAt: toIso(row.created_at),
  }
}

function resolveStoragePath(root: string, storagePath: string): string {
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(resolvedRoot, storagePath)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Invalid asset storage path")
  }
  return resolvedPath
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`
}

function assetUsageFromRow(row: AssetUsageRow | undefined, quotaBytes = getAssetQuotaBytes()): AssetUsage {
  return {
    usedBytes: Number(row?.used_bytes ?? 0),
    quotaBytes,
    assetCount: Number(row?.asset_count ?? 0),
  }
}

function normalizeListLimit(limit?: number): number {
  if (!Number.isInteger(limit) || limit === undefined) return DEFAULT_ASSET_LIST_LIMIT
  return Math.max(1, Math.min(MAX_ASSET_LIST_LIMIT, limit))
}

function assetReferencePath(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}`
}

function countAssetReferencesInBlocks(id: string, blocksText: string): number {
  return blocksText.includes(assetReferencePath(id)) ? 1 : 0
}

function localAssetReferenceCounts(ids: string[], notes: Array<{ blocks: Array<{ text: string }> }>): Map<string, number> {
  const counts = new Map(ids.map((id) => [id, 0]))
  for (const note of notes) {
    const blocksText = note.blocks.map((block) => block.text).join("\n")
    for (const id of ids) {
      if (countAssetReferencesInBlocks(id, blocksText)) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
  }
  return counts
}

function assertQuotaAvailable(usage: AssetUsage, nextBytes: number) {
  if (usage.usedBytes + nextBytes > usage.quotaBytes) {
    const remaining = Math.max(0, usage.quotaBytes - usage.usedBytes)
    throw new AssetUploadError(`文件存储空间不足，剩余 ${formatBytes(remaining)}`, 413)
  }
}

export async function createAssetFromFile(userId: string, file: File): Promise<Asset> {
  const maxUploadBytes = getMaxUploadBytes()
  if (file.size <= 0) throw new AssetUploadError("文件不能为空")
  if (file.size > maxUploadBytes) {
    throw new AssetUploadError(`文件不能超过 ${formatBytes(maxUploadBytes)}`, 413)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let contentType = detectAttachmentContentType(bytes)
  const declaredType = normalizeContentType(file.type)
  if (declaredType && ALLOWED_ASSET_TYPES.has(declaredType)) {
    if (
      contentType === "application/zip" &&
      declaredType.startsWith("application/vnd.openxmlformats-officedocument.")
    ) {
      contentType = declaredType
    } else if (contentType === "text/plain" && ALLOWED_ATTACHMENT_TYPES.has(declaredType)) {
      contentType = declaredType
    }
  }
  if (!contentType || !ALLOWED_ASSET_TYPES.has(contentType)) {
    throw new AssetUploadError("仅支持图片、PDF、文本、Markdown、CSV、JSON、Office 文档或 ZIP 文件")
  }

  if (
    declaredType &&
    ALLOWED_ASSET_TYPES.has(declaredType) &&
    declaredType !== contentType &&
    !(contentType === "text/plain" && declaredType.startsWith("text/")) &&
    !(contentType === "application/zip" && declaredType.startsWith("application/vnd.openxmlformats-officedocument."))
  ) {
    throw new AssetUploadError("文件类型与内容不一致")
  }

  const id = randomUUID()
  const extension = ALLOWED_ASSET_TYPES.get(contentType) ?? ".bin"
  const filename = safeOriginalFilename(file.name)

  if (userId === LOCAL_DESKTOP_USER_ID) {
    const store = await import("@/lib/local-vault-store")
    const root = getLocalVaultRoot()
    assertQuotaAvailable(store.getLocalAssetUsage(root, getAssetQuotaBytes()), bytes.byteLength)
    const saved = store.saveLocalAsset(root, {
      id,
      filename,
      contentType,
      sizeBytes: bytes.byteLength,
      bytes,
      extension,
    })
    return {
      id: saved.id,
      filename: saved.filename,
      contentType: saved.contentType,
      sizeBytes: saved.sizeBytes,
      url: assetUrl(saved.id),
      createdAt: saved.createdAt,
      referenceCount: 0,
    }
  }

  const root = getCloudUploadRoot()
  const storagePath = `${safeFileStem(userId)}/${id}${extension}`
  const absolutePath = resolveStoragePath(root, storagePath)
  const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`
  let moved = false

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(tmpPath, bytes, { flag: "wx" })
    await fs.rename(tmpPath, absolutePath)
    moved = true

    const result = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(8675309, hashtext($1::text))", [userId])
      const usage = await client.query<AssetUsageRow>(
        "SELECT COALESCE(SUM(size_bytes), 0) AS used_bytes, COUNT(*) AS asset_count FROM assets WHERE user_id = $1",
        [userId],
      )
      assertQuotaAvailable(assetUsageFromRow(usage.rows[0]), bytes.byteLength)
      return client.query<AssetRow>(
        `
          INSERT INTO assets (id, user_id, filename, content_type, size_bytes, storage_path)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, filename, content_type, size_bytes, storage_path, created_at
        `,
        [id, userId, filename, contentType, bytes.byteLength, storagePath],
      )
    })
    return assetFromRow(result.rows[0])
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {})
    if (moved) await fs.unlink(absolutePath).catch(() => {})
    throw error
  }
}

export async function getAssetUsage(userId: string): Promise<AssetUsage> {
  if (userId === LOCAL_DESKTOP_USER_ID) {
    const store = await import("@/lib/local-vault-store")
    return store.getLocalAssetUsage(getLocalVaultRoot(), getAssetQuotaBytes())
  }

  const result = await query<AssetUsageRow>(
    "SELECT COALESCE(SUM(size_bytes), 0) AS used_bytes, COUNT(*) AS asset_count FROM assets WHERE user_id = $1",
    [userId],
  )
  return assetUsageFromRow(result.rows[0])
}

export async function listAssets(userId: string, limit?: number): Promise<AssetList> {
  const normalizedLimit = normalizeListLimit(limit)

  if (userId === LOCAL_DESKTOP_USER_ID) {
    const store = await import("@/lib/local-vault-store")
    const root = getLocalVaultRoot()
    const assets = store.listLocalAssets(root, normalizedLimit)
    const referenceCounts = localAssetReferenceCounts(
      assets.map((asset) => asset.id),
      store.listLocalNotes(root, { includeDeleted: true }),
    )
    return {
      items: assets.map((asset) => ({
        id: asset.id,
        filename: asset.filename,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        url: assetUrl(asset.id),
        createdAt: asset.createdAt,
        referenceCount: referenceCounts.get(asset.id) ?? 0,
      })),
      usage: store.getLocalAssetUsage(root, getAssetQuotaBytes()),
    }
  }

  const [assets, usage] = await Promise.all([
    query<AssetRow>(
      `
        SELECT id, filename, content_type, size_bytes, storage_path, created_at, reference_count
        FROM (
          SELECT
            a.id,
            a.filename,
            a.content_type,
            a.size_bytes,
            a.storage_path,
            a.created_at,
            (
              SELECT COUNT(*)
              FROM notes n
              WHERE n.user_id = a.user_id
                AND n.blocks::text LIKE '%' || '/api/assets/' || a.id || '%'
            ) AS reference_count
          FROM assets a
          WHERE a.user_id = $1
        ) assets
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [userId, normalizedLimit],
    ),
    getAssetUsage(userId),
  ])

  return {
    items: assets.rows.map(assetFromRow),
    usage,
  }
}

export async function getAssetFile(userId: string, id: string): Promise<AssetFile | null> {
  if (userId === LOCAL_DESKTOP_USER_ID) {
    const store = await import("@/lib/local-vault-store")
    return store.readLocalAsset(getLocalVaultRoot(), id)
  }

  const result = await query<AssetRow>(
    `
      SELECT id, filename, content_type, size_bytes, storage_path, created_at
      FROM assets
      WHERE user_id = $1 AND id = $2
      LIMIT 1
    `,
    [userId, id],
  )
  const row = result.rows[0]
  if (!row) return null
  const stored = storedAssetFromRow(row)
  return {
    ...stored,
    absolutePath: resolveStoragePath(getCloudUploadRoot(), stored.storagePath),
  }
}

export async function deleteAsset(userId: string, id: string, options: { force?: boolean } = {}): Promise<boolean> {
  if (userId === LOCAL_DESKTOP_USER_ID) {
    const store = await import("@/lib/local-vault-store")
    const root = getLocalVaultRoot()
    if (!options.force) {
      const referenceCount = localAssetReferenceCounts(
        [id],
        store.listLocalNotes(root, { includeDeleted: true }),
      ).get(id) ?? 0
      if (referenceCount > 0) {
        throw new AssetDeleteError(`文件仍被 ${referenceCount} 篇笔记引用`, 409, referenceCount)
      }
    }
    return store.deleteLocalAsset(root, id)
  }

  const current = await query<AssetRow>(
    `
      SELECT id, filename, content_type, size_bytes, storage_path, created_at
      FROM assets
      WHERE user_id = $1 AND id = $2
      LIMIT 1
    `,
    [userId, id],
  )
  const row = current.rows[0]
  if (!row) return false
  if (!options.force) {
    const references = await query<{ reference_count: number | string }>(
      `
        SELECT COUNT(*) AS reference_count
        FROM notes
        WHERE user_id = $1
          AND blocks::text LIKE $2
      `,
      [userId, `%${assetReferencePath(id)}%`],
    )
    const referenceCount = Number(references.rows[0]?.reference_count ?? 0)
    if (referenceCount > 0) {
      throw new AssetDeleteError(`文件仍被 ${referenceCount} 篇笔记引用`, 409, referenceCount)
    }
  }
  const stored = storedAssetFromRow(row)
  await fs.unlink(resolveStoragePath(getCloudUploadRoot(), stored.storagePath)).catch((error: unknown) => {
    if ((error as { code?: string }).code !== "ENOENT") throw error
  })
  await query("DELETE FROM assets WHERE user_id = $1 AND id = $2", [userId, id])
  return true
}
