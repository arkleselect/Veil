import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createAssetFromFile,
  deleteAsset,
  detectAttachmentContentType,
  detectImageContentType,
  getAssetUsage,
  listAssets,
} from "@/lib/assets-store"
import { createLocalNote } from "@/lib/local-vault-store"
import { LOCAL_DESKTOP_USER_ID } from "@/lib/user-store"

describe("assets-store", () => {
  let originalVaultPath: string | undefined
  let originalAssetQuotaBytes: string | undefined
  let root: string

  beforeEach(() => {
    originalVaultPath = process.env.VEIL_LOCAL_VAULT_PATH
    originalAssetQuotaBytes = process.env.VEIL_ASSET_QUOTA_BYTES
    root = fs.mkdtempSync(path.join(os.tmpdir(), "veil-assets-test-"))
    process.env.VEIL_LOCAL_VAULT_PATH = root
  })

  afterEach(() => {
    if (originalVaultPath === undefined) {
      delete process.env.VEIL_LOCAL_VAULT_PATH
    } else {
      process.env.VEIL_LOCAL_VAULT_PATH = originalVaultPath
    }
    if (originalAssetQuotaBytes === undefined) {
      delete process.env.VEIL_ASSET_QUOTA_BYTES
    } else {
      process.env.VEIL_ASSET_QUOTA_BYTES = originalAssetQuotaBytes
    }
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("detects supported image content types from file signatures", () => {
    expect(detectImageContentType(new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))).toBe("image/png")

    expect(detectImageContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")

    expect(detectImageContentType(new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    ]))).toBe("image/gif")

    expect(detectImageContentType(new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]))).toBe("image/webp")
  })

  it("rejects unknown binary data", () => {
    expect(detectImageContentType(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull()
  })

  it("detects supported attachment content types", () => {
    expect(detectAttachmentContentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf")
    expect(detectAttachmentContentType(new TextEncoder().encode("plain text"))).toBe("text/plain")
  })

  it("does not expose local storage paths in upload responses", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ])
    const asset = await createAssetFromFile(
      LOCAL_DESKTOP_USER_ID,
      new File([png], "pixel.png", { type: "image/png" }),
    )

    expect(asset).toMatchObject({
      filename: "pixel.png",
      contentType: "image/png",
      sizeBytes: png.byteLength,
      url: `/api/assets/${asset.id}`,
    })
    expect(asset).not.toHaveProperty("storagePath")
  })

  it("tracks local asset usage, lists assets, and deletes files", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ])
    const asset = await createAssetFromFile(
      LOCAL_DESKTOP_USER_ID,
      new File([png], "listed.png", { type: "image/png" }),
    )
    const assetPath = path.join(root, "assets", `${asset.id}.png`)

    expect(fs.existsSync(assetPath)).toBe(true)
    await expect(listAssets(LOCAL_DESKTOP_USER_ID)).resolves.toMatchObject({
      items: [{ id: asset.id, filename: "listed.png" }],
      usage: { usedBytes: png.byteLength, assetCount: 1 },
    })
    await expect(getAssetUsage(LOCAL_DESKTOP_USER_ID)).resolves.toMatchObject({
      usedBytes: png.byteLength,
      assetCount: 1,
    })

    await expect(deleteAsset(LOCAL_DESKTOP_USER_ID, asset.id)).resolves.toBe(true)
    expect(fs.existsSync(assetPath)).toBe(false)
    await expect(getAssetUsage(LOCAL_DESKTOP_USER_ID)).resolves.toMatchObject({
      usedBytes: 0,
      assetCount: 0,
    })
    await expect(deleteAsset(LOCAL_DESKTOP_USER_ID, asset.id)).resolves.toBe(false)
  })

  it("stores non-image attachments", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    const asset = await createAssetFromFile(
      LOCAL_DESKTOP_USER_ID,
      new File([pdf], "report.pdf", { type: "application/pdf" }),
    )
    const assetPath = path.join(root, "assets", `${asset.id}.pdf`)

    expect(asset).toMatchObject({
      filename: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: pdf.byteLength,
    })
    expect(fs.existsSync(assetPath)).toBe(true)
  })

  it("blocks deletion of local assets that are still referenced by notes", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ])
    const asset = await createAssetFromFile(
      LOCAL_DESKTOP_USER_ID,
      new File([png], "referenced.png", { type: "image/png" }),
    )
    const assetPath = path.join(root, "assets", `${asset.id}.png`)

    createLocalNote(root, {
      title: "Image note",
      blocks: [{ type: "paragraph", text: `<img src="${asset.url}" alt="">` }],
    })

    await expect(listAssets(LOCAL_DESKTOP_USER_ID)).resolves.toMatchObject({
      items: [{ id: asset.id, referenceCount: 1 }],
    })
    await expect(deleteAsset(LOCAL_DESKTOP_USER_ID, asset.id)).rejects.toThrow("文件仍被 1 篇笔记引用")
    expect(fs.existsSync(assetPath)).toBe(true)

    await expect(deleteAsset(LOCAL_DESKTOP_USER_ID, asset.id, { force: true })).resolves.toBe(true)
    expect(fs.existsSync(assetPath)).toBe(false)
  })

  it("rejects uploads when the local asset quota is exceeded", async () => {
    process.env.VEIL_ASSET_QUOTA_BYTES = "8"
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ])

    await expect(createAssetFromFile(
      LOCAL_DESKTOP_USER_ID,
      new File([png], "too-large.png", { type: "image/png" }),
    )).rejects.toThrow("文件存储空间不足")
  })
})
