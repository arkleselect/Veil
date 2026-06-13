import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createLocalNote,
  createLocalNotebook,
  deleteLocalNotebook,
  emptyLocalTrash,
  getLocalNotebooks,
  getLocalAssetUsage,
  listLocalNotes,
  listLocalAssets,
  readLocalNote,
  readLocalAsset,
  reindexLocalVault,
  reorderLocalNotes,
  restoreLocalNote,
  saveLocalAsset,
  updateLocalNote,
  deleteLocalAsset,
  deleteLocalNote,
} from "@/lib/local-vault-store"
import { NoteWriteConflictError } from "@/lib/note-conflict"
import { DEFAULT_NOTEBOOK_NAME } from "@/lib/notes-data"

describe("local-vault-store", () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "veil-vault-test-"))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("creates, updates, deletes, restores, and empties local notes", () => {
    const created = createLocalNote(root, {
      title: "Local note",
      notebook: "Projects",
      tags: ["local"],
      blocks: [{ type: "paragraph", text: "First body" }],
    })
    expect(created.version).toBe(1)
    expect(created.contentHash).toMatch(/^[a-f0-9]{64}$/)

    expect(readLocalNote(root, created.id)).toMatchObject({
      id: created.id,
      title: "Local note",
      notebook: "Projects",
      tags: ["local"],
    })
    expect(getLocalNotebooks(root).find((notebook) => notebook.name === "Projects")?.count).toBe(1)

    const updated = updateLocalNote(root, created.id, {
      blocks: [{ type: "heading", text: "Updated body" }],
      starred: true,
    })
    expect(updated?.excerpt).toBe("Updated body")
    expect(updated?.starred).toBe(true)
    expect(updated?.version).toBe(created.version + 1)

    expect(deleteLocalNote(root, created.id, updated!.version)).toBe(true)
    expect(listLocalNotes(root)).toHaveLength(0)
    expect(listLocalNotes(root, { includeDeleted: true })[0]?.deletedAt).toBeTruthy()

    const deleted = listLocalNotes(root, { includeDeleted: true })[0]
    const restored = restoreLocalNote(root, created.id, deleted.version)
    expect(restored?.deletedAt).toBeUndefined()
    expect(restored?.version).toBe(deleted.version + 1)
    expect(listLocalNotes(root)).toHaveLength(1)

    expect(deleteLocalNote(root, created.id, restored!.version)).toBe(true)
    expect(emptyLocalTrash(root)).toBe(1)
    expect(listLocalNotes(root, { includeDeleted: true })).toHaveLength(0)
  })

  it("persists local note order changes", () => {
    const first = createLocalNote(root, {
      title: "First",
      blocks: [{ type: "paragraph", text: "First body" }],
    })
    const second = createLocalNote(root, {
      title: "Second",
      blocks: [{ type: "paragraph", text: "Second body" }],
    })

    reorderLocalNotes(root, [first.id, second.id])

    expect(listLocalNotes(root).map((note) => note.id).slice(0, 2)).toEqual([first.id, second.id])
    expect(readLocalNote(root, first.id)?.sortOrder).toBeGreaterThan(readLocalNote(root, second.id)?.sortOrder ?? 0)
  })

  it("rejects stale local note writes with a conflict error", () => {
    const created = createLocalNote(root, {
      title: "Versioned note",
      blocks: [{ type: "paragraph", text: "Body" }],
    })
    const updated = updateLocalNote(root, created.id, {
      title: "Fresh title",
      baseVersion: created.version,
    })

    expect(() => updateLocalNote(root, created.id, {
      title: "Stale title",
      baseVersion: created.version,
    })).toThrow(NoteWriteConflictError)
    expect(readLocalNote(root, created.id)?.title).toBe(updated?.title)
  })

  it("reindexes markdown files and preserves stored timestamps", () => {
    const created = createLocalNote(root, {
      title: "Indexed note",
      blocks: [{ type: "paragraph", text: "Indexed body" }],
    })

    const dbPath = path.join(root, ".veil", "index.sqlite")
    fs.rmSync(dbPath, { force: true })
    reindexLocalVault(root)

    const notes = listLocalNotes(root)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      id: created.id,
      title: created.title,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    })
  })

  it("moves notes to the default notebook when deleting a notebook", () => {
    const notebook = createLocalNotebook(root, { name: "Archive" })
    const note = createLocalNote(root, {
      title: "Archived note",
      notebook: "Archive",
      blocks: [{ type: "paragraph", text: "Body" }],
    })

    expect(deleteLocalNotebook(root, notebook.id)).toBe(true)

    const moved = readLocalNote(root, note.id)
    expect(moved).toMatchObject({
      id: note.id,
      notebook: DEFAULT_NOTEBOOK_NAME,
    })
    expect(getLocalNotebooks(root).find((item) => item.name === "Archive")).toBeUndefined()
    expect(getLocalNotebooks(root).find((item) => item.name === DEFAULT_NOTEBOOK_NAME)?.count).toBe(1)
  })

  it("deletes an empty default notebook but keeps a non-empty default notebook", () => {
    const emptyDefaultNotebook = createLocalNotebook(root, { name: DEFAULT_NOTEBOOK_NAME })

    expect(deleteLocalNotebook(root, emptyDefaultNotebook.id)).toBe(true)
    expect(getLocalNotebooks(root).find((item) => item.name === DEFAULT_NOTEBOOK_NAME)).toBeUndefined()

    createLocalNote(root, {
      title: "Default note",
      blocks: [{ type: "paragraph", text: "Body" }],
    })
    const defaultNotebook = getLocalNotebooks(root).find((item) => item.name === DEFAULT_NOTEBOOK_NAME)
    expect(defaultNotebook).toBeDefined()

    expect(deleteLocalNotebook(root, defaultNotebook!.id)).toBe(false)
    expect(getLocalNotebooks(root).find((item) => item.name === DEFAULT_NOTEBOOK_NAME)).toBeDefined()
  })

  it("allows deleting a default notebook that only contains trashed notes and recreates it on restore", () => {
    const note = createLocalNote(root, {
      title: "Trashed default note",
      blocks: [{ type: "paragraph", text: "Body" }],
    })

    expect(deleteLocalNote(root, note.id, note.version)).toBe(true)
    const defaultNotebook = getLocalNotebooks(root).find((item) => item.name === DEFAULT_NOTEBOOK_NAME)
    expect(defaultNotebook).toBeDefined()
    expect(defaultNotebook?.count).toBe(0)

    expect(deleteLocalNotebook(root, defaultNotebook!.id)).toBe(true)
    expect(getLocalNotebooks(root).find((item) => item.name === DEFAULT_NOTEBOOK_NAME)).toBeUndefined()

    const trashed = readLocalNote(root, note.id)
    const restored = restoreLocalNote(root, note.id, trashed!.version)
    expect(restored?.notebook).toBe(DEFAULT_NOTEBOOK_NAME)
    expect(getLocalNotebooks(root).find((item) => item.name === DEFAULT_NOTEBOOK_NAME)?.count).toBe(1)
  })

  it("stores and reads local image assets from the vault assets directory", () => {
    const saved = saveLocalAsset(root, {
      id: "asset-1",
      filename: "cover.png",
      contentType: "image/png",
      sizeBytes: 4,
      bytes: new Uint8Array([1, 2, 3, 4]),
      extension: ".png",
    })

    expect(saved).toMatchObject({
      id: "asset-1",
      filename: "cover.png",
      contentType: "image/png",
      sizeBytes: 4,
      storagePath: path.join("assets", "asset-1.png"),
    })

    const asset = readLocalAsset(root, "asset-1")
    expect(asset).toMatchObject(saved)
    expect(asset?.absolutePath).toBe(path.join(root, "assets", "asset-1.png"))
    expect(fs.readFileSync(asset!.absolutePath)).toEqual(Buffer.from([1, 2, 3, 4]))

    expect(getLocalAssetUsage(root, 100)).toMatchObject({
      usedBytes: 4,
      quotaBytes: 100,
      assetCount: 1,
    })
    expect(listLocalAssets(root, 10)).toEqual([saved])

    expect(deleteLocalAsset(root, "asset-1")).toBe(true)
    expect(readLocalAsset(root, "asset-1")).toBeNull()
    expect(fs.existsSync(path.join(root, "assets", "asset-1.png"))).toBe(false)
    expect(deleteLocalAsset(root, "asset-1")).toBe(false)
  })
})
