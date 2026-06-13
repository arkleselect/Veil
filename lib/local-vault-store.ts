import fs from "fs"
import path from "path"
import Database from "better-sqlite3"
import type { Database as SqliteDatabase } from "better-sqlite3"
import {
  DEFAULT_NOTEBOOK_ICON,
  DEFAULT_NOTEBOOK_NAME,
  type CreateNoteInput,
  type CreateNotebookInput,
  type Note,
  type Notebook,
  type UpdateNoteInput,
} from "@/lib/notes-data"
import { NoteWriteConflictError } from "@/lib/note-conflict"
import { generateExcerpt, markdownToNote, noteToMarkdown } from "@/lib/note-codec"
import { computeNoteContentHash } from "@/lib/note-version"

export interface LocalVaultPaths {
  root: string
  notesDir: string
  assetsDir: string
  veilDir: string
  indexPath: string
  configPath: string
}

export interface LocalAssetMetadata {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  storagePath: string
  createdAt: string
}

export function getLocalVaultPaths(root: string): LocalVaultPaths {
  return {
    root,
    notesDir: path.join(/*turbopackIgnore: true*/ root, "notes"),
    assetsDir: path.join(/*turbopackIgnore: true*/ root, "assets"),
    veilDir: path.join(/*turbopackIgnore: true*/ root, ".veil"),
    indexPath: path.join(/*turbopackIgnore: true*/ root, ".veil", "index.sqlite"),
    configPath: path.join(/*turbopackIgnore: true*/ root, ".veil", "config.json"),
  }
}

function ensureLocalVaultDirs(paths: LocalVaultPaths) {
  fs.mkdirSync(paths.notesDir, { recursive: true })
  fs.mkdirSync(paths.assetsDir, { recursive: true })
  fs.mkdirSync(paths.veilDir, { recursive: true })
}

function ensureSqliteColumn(db: SqliteDatabase, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
  }
}

function getDb(root: string): SqliteDatabase {
  const paths = getLocalVaultPaths(root)
  ensureLocalVaultDirs(paths)
  const db = new Database(paths.indexPath)
  db.pragma("journal_mode = WAL")
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notebook TEXT NOT NULL,
      parent_id TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      file_path TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL DEFAULT '',
      sort_order REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_local_notes_updated ON notes(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_local_notes_deleted ON notes(deleted_at);

    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      icon TEXT NOT NULL DEFAULT 'BookOpen',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_local_assets_created ON assets(created_at DESC);
  `)
  ensureSqliteColumn(db, "notes", "version", "version INTEGER NOT NULL DEFAULT 1")
  ensureSqliteColumn(db, "notes", "content_hash", "content_hash TEXT NOT NULL DEFAULT ''")
  ensureSqliteColumn(db, "notes", "parent_id", "parent_id TEXT")
  ensureSqliteColumn(db, "notes", "sort_order", "sort_order REAL")
  db.exec("CREATE INDEX IF NOT EXISTS idx_local_notes_sort_order ON notes(sort_order DESC, id DESC)")
  return db
}

function noteFilePath(root: string, noteId: string): string {
  const paths = getLocalVaultPaths(root)
  return path.join(paths.notesDir, `${safeFileStem(noteId)}.md`)
}

function safeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || generateId()
}

function writeFileAtomic(filePath: string, content: string) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmpPath, content, "utf-8")
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    throw error
  }
}

function writeBufferAtomic(filePath: string, content: Uint8Array) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmpPath, content)
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    throw error
  }
}

function resolveLocalStoragePath(root: string, storagePath: string): string {
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(resolvedRoot, storagePath)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Invalid local asset storage path")
  }
  return resolvedPath
}

function prepareLocalNote(note: Note): Note {
  const sortOrder = Number(note.sortOrder)
  const normalized: Note = {
    ...note,
    ...(Number.isFinite(sortOrder) ? { sortOrder } : {}),
    version: Number.isInteger(note.version) && note.version > 0 ? note.version : 1,
    contentHash: "",
  }
  return {
    ...normalized,
    contentHash: computeNoteContentHash(normalized),
  }
}

function fallbackSortOrder(updatedAt: string): number {
  const value = Date.parse(updatedAt)
  return Number.isFinite(value) ? value : 0
}

export function initializeLocalVault(root: string) {
  const paths = getLocalVaultPaths(root)
  ensureLocalVaultDirs(paths)
  if (!fs.existsSync(paths.configPath)) {
    fs.writeFileSync(
      paths.configPath,
      JSON.stringify({ version: 1, createdAt: new Date().toISOString() }, null, 2),
      "utf-8",
    )
  }
  getDb(root).close()
  return paths
}

export function saveLocalNote(root: string, note: Note) {
  const paths = initializeLocalVault(root)
  const filePath = noteFilePath(root, note.id)
  const prepared = prepareLocalNote(note)
  writeFileAtomic(filePath, noteToMarkdown(prepared))

  const db = getDb(root)
  try {
    const save = db.transaction(() => {
      db.prepare(`
        INSERT INTO notes (
          id, title, notebook, parent_id, tags_json, file_path, version, content_hash, sort_order, created_at, updated_at, deleted_at
        )
        VALUES (
          @id, @title, @notebook, @parentId, @tagsJson, @filePath, @version, @contentHash, @sortOrder, @createdAt, @updatedAt, @deletedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          notebook = excluded.notebook,
          parent_id = excluded.parent_id,
          tags_json = excluded.tags_json,
          file_path = excluded.file_path,
          version = excluded.version,
          content_hash = excluded.content_hash,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `).run({
        id: prepared.id,
        title: prepared.title,
        notebook: prepared.notebook,
        parentId: prepared.parentId ?? null,
        tagsJson: JSON.stringify(prepared.tags),
        filePath: path.relative(paths.root, filePath),
        version: prepared.version,
        contentHash: prepared.contentHash,
        sortOrder: prepared.sortOrder ?? fallbackSortOrder(prepared.updatedAt),
        createdAt: prepared.createdAt,
        updatedAt: prepared.updatedAt,
        deletedAt: prepared.deletedAt ?? null,
      })
    })
    save()
  } finally {
    db.close()
  }
}

export function readLocalNote(root: string, noteId: string): Note | null {
  const filePath = noteFilePath(root, noteId)
  if (!fs.existsSync(filePath)) return null
  const note = markdownToNote(fs.readFileSync(filePath, "utf-8"), noteId)
  const db = getDb(root)
  try {
    const row = db.prepare("SELECT parent_id AS parentId, sort_order AS sortOrder FROM notes WHERE id = ?").get(noteId) as { parentId?: string | null; sortOrder?: number | null } | undefined
    return prepareLocalNote({
      ...note,
      ...(row?.parentId ? { parentId: row.parentId } : {}),
      ...(typeof row?.sortOrder === "number" && Number.isFinite(row.sortOrder) ? { sortOrder: row.sortOrder } : {}),
    })
  } finally {
    db.close()
  }
}

export function saveLocalAsset(root: string, input: {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  bytes: Uint8Array
  extension: string
}): LocalAssetMetadata {
  const paths = initializeLocalVault(root)
  const createdAt = new Date().toISOString()
  const extension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`
  const filePath = path.join(paths.assetsDir, `${safeFileStem(input.id)}${extension}`)
  const storagePath = path.relative(paths.root, filePath)

  writeBufferAtomic(filePath, input.bytes)

  const db = getDb(root)
  try {
    db.prepare(`
      INSERT INTO assets (id, filename, content_type, size_bytes, storage_path, created_at)
      VALUES (@id, @filename, @contentType, @sizeBytes, @storagePath, @createdAt)
    `).run({
      id: input.id,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      storagePath,
      createdAt,
    })
  } catch (error) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    throw error
  } finally {
    db.close()
  }

  return {
    id: input.id,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    storagePath,
    createdAt,
  }
}

export function readLocalAsset(root: string, id: string): (LocalAssetMetadata & { absolutePath: string }) | null {
  initializeLocalVault(root)
  const db = getDb(root)
  try {
    const row = db.prepare(`
      SELECT
        id,
        filename,
        content_type AS contentType,
        size_bytes AS sizeBytes,
        storage_path AS storagePath,
        created_at AS createdAt
      FROM assets
      WHERE id = ?
      LIMIT 1
    `).get(id) as LocalAssetMetadata | undefined
    if (!row) return null
    return {
      ...row,
      sizeBytes: Number(row.sizeBytes),
      absolutePath: resolveLocalStoragePath(root, row.storagePath),
    }
  } finally {
    db.close()
  }
}

export function getLocalAssetUsage(root: string, quotaBytes: number): { usedBytes: number; quotaBytes: number; assetCount: number } {
  initializeLocalVault(root)
  const db = getDb(root)
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(size_bytes), 0) AS usedBytes,
        COUNT(*) AS assetCount
      FROM assets
    `).get() as { usedBytes: number | string; assetCount: number | string }
    return {
      usedBytes: Number(row.usedBytes ?? 0),
      quotaBytes,
      assetCount: Number(row.assetCount ?? 0),
    }
  } finally {
    db.close()
  }
}

export function listLocalAssets(root: string, limit: number): LocalAssetMetadata[] {
  initializeLocalVault(root)
  const db = getDb(root)
  try {
    const rows = db.prepare(`
      SELECT
        id,
        filename,
        content_type AS contentType,
        size_bytes AS sizeBytes,
        storage_path AS storagePath,
        created_at AS createdAt
      FROM assets
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as LocalAssetMetadata[]
    return rows.map((row) => ({
      ...row,
      sizeBytes: Number(row.sizeBytes),
    }))
  } finally {
    db.close()
  }
}

export function deleteLocalAsset(root: string, id: string): boolean {
  const asset = readLocalAsset(root, id)
  if (!asset) return false

  const db = getDb(root)
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM assets WHERE id = ?").run(id)
      if (fs.existsSync(asset.absolutePath)) fs.unlinkSync(asset.absolutePath)
    })()
    return true
  } finally {
    db.close()
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function notebookIdFromName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-") || "default"
}

function ensureLocalNotebook(root: string, name: string, icon = DEFAULT_NOTEBOOK_ICON) {
  const db = getDb(root)
  try {
    db.prepare(`
      INSERT INTO notebooks (id, name, icon, created_at)
      VALUES (@id, @name, @icon, @createdAt)
      ON CONFLICT(name) DO UPDATE SET icon = excluded.icon
    `).run({
      id: notebookIdFromName(name),
      name,
      icon,
      createdAt: new Date().toISOString(),
    })
  } finally {
    db.close()
  }
}

export function listLocalNotes(root: string, options: { includeDeleted?: boolean } = {}): Note[] {
  initializeLocalVault(root)
  const db = getDb(root)
  try {
    const rows = db
      .prepare(
        options.includeDeleted
          ? "SELECT id FROM notes ORDER BY COALESCE(sort_order, CAST(strftime('%s', updated_at) AS REAL) * 1000) DESC, id DESC"
          : "SELECT id FROM notes WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, CAST(strftime('%s', updated_at) AS REAL) * 1000) DESC, id DESC",
      )
      .all() as Array<{ id: string }>
    return rows
      .map((row) => readLocalNote(root, row.id))
      .filter((note): note is Note => Boolean(note))
  } finally {
    db.close()
  }
}

export function getLocalNotebooks(root: string): Notebook[] {
  initializeLocalVault(root)
  const notes = listLocalNotes(root, { includeDeleted: true })
  const counts = new Map<string, number>()
  for (const note of notes) {
    if (note.deletedAt) continue
    counts.set(note.notebook, (counts.get(note.notebook) ?? 0) + 1)
    ensureLocalNotebook(root, note.notebook, note.notebookIcon)
  }

  const db = getDb(root)
  try {
    const rows = db
      .prepare("SELECT id, name, icon, created_at AS createdAt FROM notebooks ORDER BY created_at ASC")
      .all() as Array<{ id: string; name: string; icon: string; createdAt: string }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      icon: row.icon,
      count: counts.get(row.name) ?? 0,
      createdAt: row.createdAt,
    }))
  } finally {
    db.close()
  }
}

export function createLocalNotebook(root: string, input: CreateNotebookInput): Notebook {
  initializeLocalVault(root)
  ensureLocalNotebook(root, input.name, input.icon || DEFAULT_NOTEBOOK_ICON)
  return {
    id: notebookIdFromName(input.name),
    name: input.name,
    icon: input.icon || DEFAULT_NOTEBOOK_ICON,
    count: 0,
    createdAt: new Date().toISOString(),
  }
}

export function updateLocalNotebook(root: string, id: string, input: { name?: string; icon?: string }): Notebook | null {
  initializeLocalVault(root)
  const db = getDb(root)
  let current: { id: string; name: string; icon: string; createdAt: string } | undefined
  try {
    current = db
      .prepare("SELECT id, name, icon, created_at AS createdAt FROM notebooks WHERE id = ?")
      .get(id) as typeof current
    if (!current) return null

    db.prepare("UPDATE notebooks SET id = ?, name = ?, icon = ? WHERE id = ?").run(
      input.name ? notebookIdFromName(input.name) : current.id,
      input.name ?? current.name,
      input.icon ?? current.icon,
      id,
    )
  } finally {
    db.close()
  }

  if (input.name && input.name !== current.name) {
    const notes = listLocalNotes(root, { includeDeleted: true }).filter((note) => note.notebook === current.name)
    for (const note of notes) {
      saveLocalNote(root, {
        ...note,
        notebook: input.name,
        notebookIcon: input.icon ?? note.notebookIcon,
        version: note.version + 1,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  const updated = getLocalNotebooks(root).find((notebook) => notebook.id === (input.name ? notebookIdFromName(input.name) : id))
  return updated ?? null
}

export function deleteLocalNotebook(root: string, id: string): boolean {
  initializeLocalVault(root)
  const db = getDb(root)
  let current: { id: string; name: string } | undefined
  try {
    current = db
      .prepare("SELECT id, name FROM notebooks WHERE id = ?")
      .get(id) as typeof current
  } finally {
    db.close()
  }

  if (!current) return false

  const movedAt = new Date().toISOString()
  const notes = listLocalNotes(root, { includeDeleted: true }).filter((note) => note.notebook === current.name)

  if (current.name === DEFAULT_NOTEBOOK_NAME) {
    if (notes.some((note) => !note.deletedAt)) return false
  } else {
    ensureLocalNotebook(root, DEFAULT_NOTEBOOK_NAME, DEFAULT_NOTEBOOK_ICON)
    for (const note of notes) {
      saveLocalNote(root, {
        ...note,
        notebook: DEFAULT_NOTEBOOK_NAME,
        notebookIcon: DEFAULT_NOTEBOOK_ICON,
        version: note.version + 1,
        updatedAt: movedAt,
      })
    }
  }

  const deleteDb = getDb(root)
  try {
    const result = deleteDb.prepare("DELETE FROM notebooks WHERE id = ?").run(id)
    return result.changes > 0
  } finally {
    deleteDb.close()
  }
}

export function createLocalNote(root: string, input: CreateNoteInput): Note {
  const now = new Date().toISOString()
  const blocks = input.blocks || [{ type: "paragraph" as const, text: "" }]
  const notebook = input.notebook || DEFAULT_NOTEBOOK_NAME
  const notebookIcon = input.notebookIcon || DEFAULT_NOTEBOOK_ICON
  ensureLocalNotebook(root, notebook, notebookIcon)
  const note: Note = {
    id: generateId(),
    title: input.title || "无标题笔记",
    excerpt: generateExcerpt(blocks),
    notebook,
    notebookIcon,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    date: now.slice(0, 10),
    starred: false,
    tags: input.tags || [],
    blocks,
    version: 1,
    contentHash: "",
    sortOrder: Date.parse(now),
    createdAt: now,
    updatedAt: now,
  }
  const prepared = prepareLocalNote(note)
  saveLocalNote(root, prepared)
  return prepared
}

export function updateLocalNote(root: string, id: string, input: UpdateNoteInput): Note | null {
  const current = readLocalNote(root, id)
  if (!current) return null
  if (input.baseVersion !== undefined && input.baseVersion !== current.version) {
    throw new NoteWriteConflictError(current)
  }
  const blocks = input.blocks ?? current.blocks
  const deletedAt = input.deletedAt === null ? undefined : (input.deletedAt ?? current.deletedAt)
  const updated: Note = {
    ...current,
    title: input.title ?? current.title,
    notebook: input.notebook ?? current.notebook,
    notebookIcon: input.notebookIcon ?? current.notebookIcon,
    parentId: input.parentId === null ? undefined : (input.parentId ?? current.parentId),
    starred: input.starred ?? current.starred,
    tags: input.tags ?? current.tags,
    blocks,
    excerpt: input.blocks ? generateExcerpt(blocks) : (input.excerpt ?? current.excerpt),
    version: current.version + 1,
    contentHash: "",
    updatedAt: new Date().toISOString(),
    ...(deletedAt ? { deletedAt } : { deletedAt: undefined }),
  }
  const prepared = prepareLocalNote(updated)
  saveLocalNote(root, prepared)
  return prepared
}

export function reorderLocalNotes(root: string, orderedIds: string[]): Note[] {
  const seen = new Set<string>()
  const ids = orderedIds
    .map((id) => id.trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
  if (ids.length < 2) return []

  const baseSortOrder = Date.now()
  const updated: Note[] = []
  for (const [index, id] of ids.entries()) {
    const note = readLocalNote(root, id)
    if (!note || note.deletedAt) continue
    const next = prepareLocalNote({
      ...note,
      sortOrder: baseSortOrder - index,
    })
    saveLocalNote(root, next)
    updated.push(next)
  }
  return updated
}

export function deleteLocalNote(root: string, id: string, baseVersion?: number): boolean {
  const current = readLocalNote(root, id)
  if (!current || current.deletedAt) return false
  if (baseVersion !== undefined && baseVersion !== current.version) {
    throw new NoteWriteConflictError(current)
  }
  saveLocalNote(root, {
    ...current,
    deletedAt: new Date().toISOString(),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  })
  return true
}

export function restoreLocalNote(root: string, id: string, baseVersion?: number): Note | null {
  const current = readLocalNote(root, id)
  if (!current || !current.deletedAt) return null
  if (baseVersion !== undefined && baseVersion !== current.version) {
    throw new NoteWriteConflictError(current)
  }
  const restored = prepareLocalNote({
    ...current,
    deletedAt: undefined,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  })
  ensureLocalNotebook(root, restored.notebook, restored.notebookIcon)
  saveLocalNote(root, restored)
  return restored
}

export function emptyLocalTrash(root: string): number {
  const notes = listLocalNotes(root, { includeDeleted: true }).filter((note) => note.deletedAt)
  for (const note of notes) {
    const filePath = noteFilePath(root, note.id)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
  reindexLocalVault(root)
  return notes.length
}

export function applyLocalSyncPush(root: string, items: Array<{
  id: string
  markdown: string
  updatedAt: string
  baseVersion?: number
  version?: number
  contentHash?: string
  deleted?: boolean
}>) {
  const conflicts: string[] = []
  let accepted = 0

  for (const item of items) {
    const existing = readLocalNote(root, item.id)
    if (existing && item.baseVersion !== undefined && item.baseVersion !== existing.version) {
      conflicts.push(item.id)
      continue
    }
    if (existing && item.baseVersion === undefined && existing.updatedAt > item.updatedAt) {
      conflicts.push(item.id)
      continue
    }

    if (item.deleted) {
      if (existing) {
        saveLocalNote(root, {
          ...existing,
          deletedAt: new Date().toISOString(),
          version: existing.version + 1,
          updatedAt: item.updatedAt,
        })
        accepted++
      }
      continue
    }

    const note = markdownToNote(item.markdown, item.id)
    const version = existing ? existing.version + 1 : (item.version ?? note.version)
    saveLocalNote(root, {
      ...note,
      version,
      updatedAt: item.updatedAt,
      createdAt: existing?.createdAt ?? note.createdAt,
    })
    accepted++
  }

  return { accepted, conflicts }
}

export function reindexLocalVault(root: string) {
  const paths = initializeLocalVault(root)
  const db = getDb(root)
  try {
    const files = fs.readdirSync(paths.notesDir).filter((file) => file.endsWith(".md"))
    const upsert = db.prepare(`
      INSERT INTO notes (
        id, title, notebook, parent_id, tags_json, file_path, version, content_hash, sort_order, created_at, updated_at, deleted_at
      )
      VALUES (
        @id, @title, @notebook, @parentId, @tagsJson, @filePath, @version, @contentHash, @sortOrder, @createdAt, @updatedAt, @deletedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        notebook = excluded.notebook,
        parent_id = excluded.parent_id,
        tags_json = excluded.tags_json,
        file_path = excluded.file_path,
        version = excluded.version,
        content_hash = excluded.content_hash,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `)
    const transaction = db.transaction(() => {
      const seenIds = new Set<string>()
      for (const file of files) {
        const absolute = path.join(paths.notesDir, file)
        const id = path.basename(file, ".md")
        const note = markdownToNote(fs.readFileSync(absolute, "utf-8"), id)
        const prepared = prepareLocalNote(note)
        seenIds.add(note.id)
        upsert.run({
          id: prepared.id,
          title: prepared.title,
          notebook: prepared.notebook,
          parentId: prepared.parentId ?? null,
          tagsJson: JSON.stringify(prepared.tags),
          filePath: path.relative(paths.root, absolute),
          version: prepared.version,
          contentHash: prepared.contentHash,
          sortOrder: prepared.sortOrder ?? fallbackSortOrder(prepared.updatedAt),
          createdAt: prepared.createdAt,
          updatedAt: prepared.updatedAt,
          deletedAt: prepared.deletedAt ?? null,
        })
      }
      const existing = db.prepare("SELECT id FROM notes").all() as Array<{ id: string }>
      const deleteMissing = db.prepare("DELETE FROM notes WHERE id = ?")
      for (const row of existing) {
        if (!seenIds.has(row.id)) deleteMissing.run(row.id)
      }
    })
    transaction()
  } finally {
    db.close()
  }
}
