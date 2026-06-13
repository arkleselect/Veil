import { randomUUID } from "crypto"
import sanitizeHtml from "sanitize-html"
import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import { getLocalVaultRoot } from "@/lib/local-vault-path"
import {
  DEFAULT_NOTEBOOK_ICON,
  DEFAULT_NOTEBOOK_NAME,
  type Note,
  type Notebook,
  type NotesPage,
  type TagSummary,
  type NoteBlock,
  type CreateNoteInput,
  type UpdateNoteInput,
  type CreateNotebookInput,
} from "./notes-data"
import { LOCAL_DESKTOP_USER_ID } from "@/lib/user-store"
import {
  markdownToNote as decodeMarkdownNote,
  noteToMarkdown as encodeMarkdownNote,
} from "@/lib/note-codec"
import { NoteWriteConflictError } from "@/lib/note-conflict"
import { computeNoteContentHash } from "@/lib/note-version"

const NOTE_SELECT_COLUMNS = `
  id, title, excerpt, notebook, notebook_icon, parent_id, note_date, starred, tags, blocks,
  version, content_hash, sort_order, created_at, updated_at, deleted_at
`
const NOTE_SORT_ORDER_SQL = "COALESCE(sort_order, (EXTRACT(EPOCH FROM updated_at) * 1000)::double precision)"
const DEFAULT_NOTES_PAGE_LIMIT = 50
const MAX_NOTES_PAGE_LIMIT = 100

interface GetNotesPageOptions {
  notebook?: string
  q?: string
  tag?: string
  date?: string
  starred?: boolean
  cursor?: string
  limit?: number
}

interface NotesPageCursor {
  sortOrder: number
  id: string
}

interface TagSummaryRow {
  name: string
  count: string | number
}

export class InvalidNotesCursorError extends Error {
  constructor() {
    super("无效的分页游标")
    this.name = "InvalidNotesCursorError"
  }
}

function generateId(): string {
  return randomUUID()
}

function isLocalDesktopUser(userId: string): boolean {
  return userId === LOCAL_DESKTOP_USER_ID
}

async function localVaultStore() {
  return import("@/lib/local-vault-store")
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "")
}

function sanitizeBlockHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a", "b", "br", "code", "em", "i", "img", "kbd", "mark", "s", "span", "strong",
      "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading", "class"],
      table: ["class"],
      tbody: ["class"],
      td: ["class", "colspan", "rowspan"],
      tfoot: ["class"],
      th: ["class", "colspan", "rowspan"],
      thead: ["class"],
      tr: ["class"],
      span: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }),
    },
  })
}

function sanitizeBlocks(blocks: NoteBlock[]): NoteBlock[] {
  return blocks.map((block) => ({
    ...block,
    text: sanitizeBlockHtml(block.text),
  }))
}

function generateExcerpt(blocks: NoteBlock[]): string {
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "heading" || block.type === "highlight" || block.type === "columns" || block.type === "toggle") {
      const plain = stripHtml(block.text)
      return plain.length > 80 ? `${plain.slice(0, 80)}...` : plain
    }
  }
  return ""
}

interface NoteRow {
  id: string
  title: string
  excerpt: string
  notebook: string
  notebook_icon: string
  parent_id: string | null
  note_date: string
  starred: boolean
  tags: string[] | null
  blocks: NoteBlock[] | null
  version: number | string | null
  content_hash: string | null
  sort_order: number | string | null
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

interface NotebookRow {
  id: string
  name: string
  icon: string
  count: string | number
  created_at: Date | string
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function fallbackSortOrder(updatedAt: string): number {
  const value = Date.parse(updatedAt)
  return Number.isFinite(value) ? value : 0
}

function noteSortOrder(note: Pick<Note, "sortOrder" | "updatedAt">): number {
  return typeof note.sortOrder === "number" && Number.isFinite(note.sortOrder)
    ? note.sortOrder
    : fallbackSortOrder(note.updatedAt)
}

function uniqueNoteIds(ids: string[]): string[] {
  const seen = new Set<string>()
  return ids
    .map((id) => id.trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
}

function noteFromRow(row: NoteRow): Note {
  const deletedAt = row.deleted_at ? toIso(row.deleted_at) : undefined
  const blocks = sanitizeBlocks(Array.isArray(row.blocks) ? row.blocks : [])
  const updatedAt = toIso(row.updated_at)
  const sortOrder = Number(row.sort_order)
  const note: Note = {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    notebook: row.notebook,
    notebookIcon: row.notebook_icon,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    date: row.note_date,
    starred: row.starred,
    tags: Array.isArray(row.tags) ? row.tags : [],
    blocks,
    version: Number(row.version ?? 1),
    contentHash: row.content_hash || "",
    createdAt: toIso(row.created_at),
    updatedAt,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : fallbackSortOrder(updatedAt),
    ...(deletedAt ? { deletedAt } : {}),
  }
  return {
    ...note,
    contentHash: note.contentHash || computeNoteContentHash(note),
  }
}

function notebookFromRow(row: NotebookRow): Notebook {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    count: Number(row.count),
    createdAt: toIso(row.created_at),
  }
}

async function updateNotebookNoteMetadata(
  client: { query: PoolClient["query"] },
  userId: string,
  currentNotebook: string,
  nextNotebook: string,
  nextNotebookIcon?: string,
) {
  const now = new Date().toISOString()
  const affected = await client.query<NoteRow>(
    `
      SELECT ${NOTE_SELECT_COLUMNS}
      FROM notes
      WHERE user_id = $1 AND notebook = $2
      FOR UPDATE
    `,
    [userId, currentNotebook],
  )

  for (const row of affected.rows) {
    const note = noteFromRow(row)
    const nextNote: Note = {
      ...note,
      notebook: nextNotebook,
      notebookIcon: nextNotebookIcon ?? note.notebookIcon,
      version: note.version + 1,
      updatedAt: now,
    }
    await client.query(
      `
        UPDATE notes
        SET notebook = $1,
            notebook_icon = $2,
            version = $3,
            content_hash = $4,
            updated_at = $5::timestamptz
        WHERE user_id = $6 AND id = $7
      `,
      [
        nextNote.notebook,
        nextNote.notebookIcon,
        nextNote.version,
        computeNoteContentHash(nextNote),
        nextNote.updatedAt,
        userId,
        nextNote.id,
      ],
    )
  }
}

function normalizePageLimit(limit?: number): number {
  if (!Number.isInteger(limit) || limit === undefined) return DEFAULT_NOTES_PAGE_LIMIT
  return Math.max(1, Math.min(MAX_NOTES_PAGE_LIMIT, limit))
}

function encodeNotesCursor(cursor: NotesPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url")
}

function decodeNotesCursor(value?: string): NotesPageCursor | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as Partial<NotesPageCursor> & { updatedAt?: unknown }
    if (
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new InvalidNotesCursorError()
    }
    if (typeof parsed.sortOrder === "number" && Number.isFinite(parsed.sortOrder)) {
      return {
        id: parsed.id,
        sortOrder: parsed.sortOrder,
      }
    }
    if (typeof parsed.updatedAt === "string" && !Number.isNaN(Date.parse(parsed.updatedAt))) {
      return {
        id: parsed.id,
        sortOrder: fallbackSortOrder(new Date(parsed.updatedAt).toISOString()),
      }
    }
    throw new InvalidNotesCursorError()
  } catch {
    throw new InvalidNotesCursorError()
  }
}

function resolveNoteDate(value?: string): string | undefined {
  if (!value) return undefined
  if (value === "today") return new Date().toISOString().slice(0, 10)
  return value
}

function matchesNotesQuery(note: Note, queryText?: string): boolean {
  const q = queryText?.trim().toLowerCase()
  if (!q) return true
  return (
    note.title.toLowerCase().includes(q) ||
    note.excerpt.toLowerCase().includes(q) ||
    note.notebook.toLowerCase().includes(q) ||
    note.tags.some((tag) => tag.toLowerCase().includes(q))
  )
}

function sortNotesForPage(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    const orderCompare = noteSortOrder(b) - noteSortOrder(a)
    return orderCompare === 0 ? b.id.localeCompare(a.id) : orderCompare
  })
}

function pageFromSortedNotes(notes: Note[], cursor: NotesPageCursor | undefined, limit: number): NotesPage {
  const start = cursor
    ? notes.findIndex((note) => (
        noteSortOrder(note) < cursor.sortOrder ||
        (noteSortOrder(note) === cursor.sortOrder && note.id < cursor.id)
      ))
    : 0
  const pageStart = start < 0 ? notes.length : start
  const pageItems = notes.slice(pageStart, pageStart + limit + 1)
  const items = pageItems.slice(0, limit)
  const last = items.at(-1)
  return {
    items,
    hasMore: pageItems.length > limit,
    ...(pageItems.length > limit && last
      ? { nextCursor: encodeNotesCursor({ sortOrder: noteSortOrder(last), id: last.id }) }
      : {}),
  }
}

async function ensureNotebook(userId: string, name: string, icon = DEFAULT_NOTEBOOK_ICON) {
  await query(
    `
      INSERT INTO notebooks (id, user_id, name, icon)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, name) DO NOTHING
    `,
    [generateId(), userId, name, icon],
  )
}

export async function getNotebooks(userId: string): Promise<Notebook[]> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.getLocalNotebooks(getLocalVaultRoot())
  }

  const result = await query<NotebookRow>(
    `
      SELECT
        nb.id,
        nb.name,
        nb.icon,
        nb.created_at,
        COUNT(n.id) FILTER (WHERE n.deleted_at IS NULL) AS count
      FROM notebooks nb
      LEFT JOIN notes n ON n.user_id = nb.user_id AND n.notebook = nb.name
      WHERE nb.user_id = $1
      GROUP BY nb.id, nb.name, nb.icon, nb.created_at
      ORDER BY nb.created_at ASC
    `,
    [userId],
  )
  return result.rows.map(notebookFromRow)
}

export async function updateNotebook(userId: string, id: string, data: { name?: string; icon?: string }): Promise<Notebook | null> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.updateLocalNotebook(getLocalVaultRoot(), id, data)
  }

  return withTransaction(async (client) => {
    const current = await client.query<{ name: string; icon: string }>(
      "SELECT name, icon FROM notebooks WHERE user_id = $1 AND id = $2",
      [userId, id],
    )
    const existing = current.rows[0]
    if (!existing) return null

    const nextName = data.name ?? existing.name
    const updated = await client.query<Omit<NotebookRow, "count">>(
      `
        UPDATE notebooks
        SET name = $1, icon = COALESCE($2, icon)
        WHERE user_id = $3 AND id = $4
        RETURNING id, name, icon, created_at
      `,
      [nextName, data.icon ?? null, userId, id],
    )
    if ((data.name && data.name !== existing.name) || (data.icon && data.icon !== existing.icon)) {
      await updateNotebookNoteMetadata(
        client,
        userId,
        existing.name,
        nextName,
        data.icon,
      )
    }

    const count = await client.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM notes WHERE user_id = $1 AND notebook = $2 AND deleted_at IS NULL",
      [userId, nextName],
    )
    return updated.rows[0]
      ? notebookFromRow({ ...updated.rows[0], count: count.rows[0]?.count ?? 0 })
      : null
  })
}

export async function deleteNotebook(userId: string, id: string): Promise<boolean> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.deleteLocalNotebook(getLocalVaultRoot(), id)
  }

  return withTransaction(async (client) => {
    const current = await client.query<{ name: string }>(
      "SELECT name FROM notebooks WHERE user_id = $1 AND id = $2",
      [userId, id],
    )
    const existing = current.rows[0]
    if (!existing) return false

    if (existing.name === DEFAULT_NOTEBOOK_NAME) {
      const noteCount = await client.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM notes WHERE user_id = $1 AND notebook = $2 AND deleted_at IS NULL",
        [userId, existing.name],
      )
      if (Number(noteCount.rows[0]?.count ?? 0) > 0) return false

      const result = await client.query(
        "DELETE FROM notebooks WHERE user_id = $1 AND id = $2",
        [userId, id],
      )
      return (result.rowCount ?? 0) > 0
    }

    await client.query(
      `
        INSERT INTO notebooks (id, user_id, name, icon)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, name) DO NOTHING
      `,
      [
        generateId(),
        userId,
        DEFAULT_NOTEBOOK_NAME,
        DEFAULT_NOTEBOOK_ICON,
      ],
    )
    await updateNotebookNoteMetadata(
      client,
      userId,
      existing.name,
      DEFAULT_NOTEBOOK_NAME,
      DEFAULT_NOTEBOOK_ICON,
    )

    const result = await client.query(
      "DELETE FROM notebooks WHERE user_id = $1 AND id = $2",
      [userId, id],
    )
    return (result.rowCount ?? 0) > 0
  })
}

export async function createNotebook(userId: string, input: CreateNotebookInput): Promise<Notebook> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.createLocalNotebook(getLocalVaultRoot(), input)
  }

  const id = generateId()
  const result = await query<NotebookRow>(
    `
      INSERT INTO notebooks (id, user_id, name, icon)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, name)
      DO UPDATE SET icon = EXCLUDED.icon
      RETURNING id, name, icon, 0 AS count, created_at
    `,
    [id, userId, input.name, input.icon || DEFAULT_NOTEBOOK_ICON],
  )
  return notebookFromRow(result.rows[0])
}

export async function getNotes(userId: string, notebookId?: string): Promise<Note[]> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    const root = getLocalVaultRoot()
    const notes = store.listLocalNotes(root)
    if (!notebookId) return notes
    const notebook = store.getLocalNotebooks(root).find((item) => item.id === notebookId)
    return notebook ? notes.filter((note) => note.notebook === notebook.name) : []
  }

  let notebookName: string | undefined
  if (notebookId) {
    const notebook = await query<{ name: string }>(
      "SELECT name FROM notebooks WHERE user_id = $1 AND id = $2",
      [userId, notebookId],
    )
    notebookName = notebook.rows[0]?.name
    if (!notebookName) return []
  }

  const result = await query<NoteRow>(
    `
      SELECT ${NOTE_SELECT_COLUMNS}
      FROM notes
      WHERE user_id = $1
        AND deleted_at IS NULL
        AND ($2::text IS NULL OR notebook = $2)
      ORDER BY ${NOTE_SORT_ORDER_SQL} DESC, id DESC
    `,
    [userId, notebookName ?? null],
  )
  return result.rows.map(noteFromRow)
}

export async function getNotesPage(userId: string, options: GetNotesPageOptions = {}): Promise<NotesPage> {
  const limit = normalizePageLimit(options.limit)
  const cursor = decodeNotesCursor(options.cursor)
  const date = resolveNoteDate(options.date)
  const q = options.q?.trim()
  const tag = options.tag?.trim()

  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    const root = getLocalVaultRoot()
    const notebooks = store.getLocalNotebooks(root)
    const notebookName = options.notebook
      ? notebooks.find((item) => item.id === options.notebook)?.name
      : undefined

    if (options.notebook && !notebookName) {
      return { items: [], hasMore: false }
    }

    const notes = sortNotesForPage(
      store.listLocalNotes(root).filter((note) => (
        (!notebookName || note.notebook === notebookName) &&
        (!date || note.date === date) &&
        (options.starred === undefined || note.starred === options.starred) &&
        (!tag || note.tags.includes(tag)) &&
        matchesNotesQuery(note, q)
      )),
    )
    return pageFromSortedNotes(notes, cursor, limit)
  }

  let notebookName: string | undefined
  if (options.notebook) {
    const notebook = await query<{ name: string }>(
      "SELECT name FROM notebooks WHERE user_id = $1 AND id = $2",
      [userId, options.notebook],
    )
    notebookName = notebook.rows[0]?.name
    if (!notebookName) return { items: [], hasMore: false }
  }

  const values: unknown[] = [userId]
  const where = ["user_id = $1", "deleted_at IS NULL"]
  const addValue = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }

  if (notebookName) {
    where.push(`notebook = ${addValue(notebookName)}`)
  }
  if (date) {
    where.push(`note_date = ${addValue(date)}`)
  }
  if (options.starred !== undefined) {
    where.push(`starred = ${addValue(options.starred)}`)
  }
  if (tag) {
    where.push(`tags ? ${addValue(tag)}`)
  }
  if (q) {
    const searchPlaceholder = addValue(q)
    const likePlaceholder = addValue(`%${q}%`)
    where.push(`(
      search_vector @@ websearch_to_tsquery('simple', ${searchPlaceholder})
      OR title ILIKE ${likePlaceholder}
      OR excerpt ILIKE ${likePlaceholder}
      OR notebook ILIKE ${likePlaceholder}
      OR tags::text ILIKE ${likePlaceholder}
    )`)
  }
  if (cursor) {
    const sortOrderPlaceholder = addValue(cursor.sortOrder)
    const idPlaceholder = addValue(cursor.id)
    where.push(`(
      ${NOTE_SORT_ORDER_SQL} < ${sortOrderPlaceholder}::double precision
      OR (${NOTE_SORT_ORDER_SQL} = ${sortOrderPlaceholder}::double precision AND id < ${idPlaceholder})
    )`)
  }

  const limitPlaceholder = addValue(limit + 1)
  const result = await query<NoteRow>(
    `
      SELECT ${NOTE_SELECT_COLUMNS}
      FROM notes
      WHERE ${where.join(" AND ")}
      ORDER BY ${NOTE_SORT_ORDER_SQL} DESC, id DESC
      LIMIT ${limitPlaceholder}
    `,
    values,
  )
  const pageRows = result.rows.slice(0, limit)
  const last = pageRows.at(-1)
  return {
    items: pageRows.map(noteFromRow),
    hasMore: result.rows.length > limit,
    ...(result.rows.length > limit && last
      ? { nextCursor: encodeNotesCursor({ sortOrder: noteSortOrder(noteFromRow(last)), id: last.id }) }
      : {}),
  }
}

export async function getTagSummaries(userId: string): Promise<TagSummary[]> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    const counts = new Map<string, number>()
    for (const note of store.listLocalNotes(getLocalVaultRoot())) {
      for (const tag of note.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const result = await query<TagSummaryRow>(
    `
      SELECT tag.value AS name, COUNT(*) AS count
      FROM notes
      CROSS JOIN LATERAL jsonb_array_elements_text(tags) AS tag(value)
      WHERE user_id = $1 AND deleted_at IS NULL
      GROUP BY tag.value
      ORDER BY lower(tag.value) ASC
    `,
    [userId],
  )
  return result.rows.map((row) => ({ name: row.name, count: Number(row.count) }))
}

export async function getTrashNotes(userId: string): Promise<Note[]> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.listLocalNotes(getLocalVaultRoot(), { includeDeleted: true }).filter((note) => note.deletedAt)
  }

  const result = await query<NoteRow>(
    `
      SELECT ${NOTE_SELECT_COLUMNS}
      FROM notes
      WHERE user_id = $1 AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `,
    [userId],
  )
  return result.rows.map(noteFromRow)
}

export async function getNote(userId: string, id: string): Promise<Note | null> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.readLocalNote(getLocalVaultRoot(), id)
  }

  const result = await query<NoteRow>(
    `
      SELECT ${NOTE_SELECT_COLUMNS}
      FROM notes
      WHERE user_id = $1 AND id = $2
      LIMIT 1
    `,
    [userId, id],
  )
  return result.rows[0] ? noteFromRow(result.rows[0]) : null
}

export async function createNote(userId: string, input: CreateNoteInput): Promise<Note> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.createLocalNote(getLocalVaultRoot(), {
      ...input,
      blocks: input.blocks ? sanitizeBlocks(input.blocks) : input.blocks,
    })
  }

  const now = new Date()
  const sortOrder = now.getTime()
  const today = now.toISOString().slice(0, 10)
  const blocks = sanitizeBlocks(input.blocks || [{ type: "paragraph" as const, text: "" }])
  const parent = input.parentId ? await getNote(userId, input.parentId) : null
  const parentId = parent && !parent.deletedAt ? parent.id : undefined
  const notebook = parent?.notebook || input.notebook || DEFAULT_NOTEBOOK_NAME
  const notebookIcon = parent?.notebookIcon || input.notebookIcon || DEFAULT_NOTEBOOK_ICON
  const title = input.title || "无标题笔记"
  const excerpt = generateExcerpt(blocks)
  const tags = input.tags || []
  const contentHash = computeNoteContentHash({
    title,
    excerpt,
    notebook,
    notebookIcon,
    ...(parentId ? { parentId } : {}),
    date: today,
    starred: false,
    tags,
    blocks,
  })
  await ensureNotebook(userId, notebook, notebookIcon)

  const result = await query<NoteRow>(
    `
      INSERT INTO notes (
        id, user_id, title, excerpt, notebook, notebook_icon, parent_id, note_date, starred,
        tags, blocks, version, content_hash, sort_order, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9::jsonb, $10::jsonb, 1, $11, $12, $13, $13)
      RETURNING ${NOTE_SELECT_COLUMNS}
    `,
    [
      generateId(),
      userId,
      title,
      excerpt,
      notebook,
      notebookIcon,
      parentId ?? null,
      today,
      JSON.stringify(tags),
      JSON.stringify(blocks),
      contentHash,
      sortOrder,
      now,
    ],
  )
  return noteFromRow(result.rows[0])
}

export async function updateNote(userId: string, id: string, input: UpdateNoteInput): Promise<Note | null> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.updateLocalNote(getLocalVaultRoot(), id, {
      ...input,
      blocks: input.blocks ? sanitizeBlocks(input.blocks) : input.blocks,
    })
  }

  const existing = await getNote(userId, id)
  if (!existing) return null
  if (input.baseVersion !== undefined && input.baseVersion !== existing.version) {
    throw new NoteWriteConflictError(existing)
  }

  const blocks = input.blocks !== undefined ? sanitizeBlocks(input.blocks) : existing.blocks
  const notebook = input.notebook ?? existing.notebook
  const notebookIcon = input.notebookIcon ?? existing.notebookIcon
  if (input.notebook !== undefined) {
    await ensureNotebook(userId, notebook, notebookIcon)
  }
  const title = input.title ?? existing.title
  const excerpt = input.blocks !== undefined ? generateExcerpt(blocks) : (input.excerpt ?? existing.excerpt)
  const starred = input.starred ?? existing.starred
  const parentId = input.parentId === null
    ? undefined
    : input.parentId !== undefined && input.parentId !== id
      ? input.parentId
      : existing.parentId
  const tags = input.tags ?? existing.tags
  const deletedAt = input.deletedAt === null ? undefined : (input.deletedAt ?? existing.deletedAt)
  const nextVersion = existing.version + 1
  const contentHash = computeNoteContentHash({
    title,
    excerpt,
    notebook,
    notebookIcon,
    ...(parentId ? { parentId } : {}),
    date: existing.date,
    starred,
    tags,
    blocks,
    ...(deletedAt ? { deletedAt } : {}),
  })

  const result = await query<NoteRow>(
    `
      UPDATE notes
      SET
        title = $1,
        excerpt = $2,
        notebook = $3,
        notebook_icon = $4,
        parent_id = $5,
        starred = $6,
        tags = $7::jsonb,
        blocks = $8::jsonb,
        deleted_at = $9::timestamptz,
        version = $10,
        content_hash = $11,
        updated_at = NOW()
      WHERE user_id = $12 AND id = $13 AND version = $14
      RETURNING ${NOTE_SELECT_COLUMNS}
    `,
    [
      title,
      excerpt,
      notebook,
      notebookIcon,
      parentId ?? null,
      starred,
      JSON.stringify(tags),
      JSON.stringify(blocks),
      deletedAt ?? null,
      nextVersion,
      contentHash,
      userId,
      id,
      existing.version,
    ],
  )
  if (result.rows[0]) return noteFromRow(result.rows[0])

  const current = await getNote(userId, id)
  if (current) throw new NoteWriteConflictError(current)
  return null
}

export async function reorderNotes(userId: string, orderedIds: string[]): Promise<Note[]> {
  const ids = uniqueNoteIds(orderedIds)
  if (ids.length < 2) return []

  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.reorderLocalNotes(getLocalVaultRoot(), ids)
  }

  const baseSortOrder = Date.now()
  const rows = await withTransaction(async (client) => {
    const existing = await client.query<NoteRow>(
      `
        SELECT ${NOTE_SELECT_COLUMNS}
        FROM notes
        WHERE user_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL
        FOR UPDATE
      `,
      [userId, ids],
    )
    const existingIds = new Set(existing.rows.map((row) => row.id))
    const updated: NoteRow[] = []

    for (const [index, noteId] of ids.entries()) {
      if (!existingIds.has(noteId)) continue
      const result = await client.query<NoteRow>(
        `
          UPDATE notes
          SET sort_order = $1
          WHERE user_id = $2 AND id = $3 AND deleted_at IS NULL
          RETURNING ${NOTE_SELECT_COLUMNS}
        `,
        [baseSortOrder - index, userId, noteId],
      )
      if (result.rows[0]) updated.push(result.rows[0])
    }

    return updated
  })

  const order = new Map(ids.map((id, index) => [id, index]))
  return rows
    .map(noteFromRow)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

export async function deleteNote(userId: string, id: string, baseVersion?: number): Promise<boolean> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.deleteLocalNote(getLocalVaultRoot(), id, baseVersion)
  }

  const existing = await getNote(userId, id)
  if (!existing || existing.deletedAt) return false
  if (baseVersion !== undefined && baseVersion !== existing.version) {
    throw new NoteWriteConflictError(existing)
  }

  const deletedAt = new Date().toISOString()
  const contentHash = computeNoteContentHash({ ...existing, deletedAt })
  const result = await query<NoteRow>(
    `
      UPDATE notes
      SET deleted_at = $1::timestamptz, version = $2, content_hash = $3, updated_at = NOW()
      WHERE user_id = $4 AND id = $5 AND deleted_at IS NULL AND version = $6
      RETURNING ${NOTE_SELECT_COLUMNS}
    `,
    [deletedAt, existing.version + 1, contentHash, userId, id, existing.version],
  )
  if ((result.rowCount ?? 0) > 0) return true

  const current = await getNote(userId, id)
  if (current) throw new NoteWriteConflictError(current)
  return false
}

export async function restoreNote(userId: string, id: string, baseVersion?: number): Promise<Note | null> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.restoreLocalNote(getLocalVaultRoot(), id, baseVersion)
  }

  const existing = await getNote(userId, id)
  if (!existing || !existing.deletedAt) return null
  if (baseVersion !== undefined && baseVersion !== existing.version) {
    throw new NoteWriteConflictError(existing)
  }

  const contentHash = computeNoteContentHash({ ...existing, deletedAt: undefined })
  await ensureNotebook(userId, existing.notebook, existing.notebookIcon)
  const result = await query<NoteRow>(
    `
      UPDATE notes
      SET deleted_at = NULL, version = $1, content_hash = $2, updated_at = NOW()
      WHERE user_id = $3 AND id = $4 AND deleted_at IS NOT NULL AND version = $5
      RETURNING ${NOTE_SELECT_COLUMNS}
    `,
    [existing.version + 1, contentHash, userId, id, existing.version],
  )
  if (result.rows[0]) return noteFromRow(result.rows[0])

  const current = await getNote(userId, id)
  if (current) throw new NoteWriteConflictError(current)
  return null
}

export async function emptyTrash(userId: string): Promise<number> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.emptyLocalTrash(getLocalVaultRoot())
  }

  const result = await query(
    "DELETE FROM notes WHERE user_id = $1 AND deleted_at IS NOT NULL",
    [userId],
  )
  return result.rowCount ?? 0
}

export async function getFavorites(userId: string): Promise<Note[]> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.listLocalNotes(getLocalVaultRoot()).filter((note) => note.starred)
  }

  const result = await query<NoteRow>(
    `
      SELECT ${NOTE_SELECT_COLUMNS}
      FROM notes
      WHERE user_id = $1 AND starred = TRUE AND deleted_at IS NULL
      ORDER BY ${NOTE_SORT_ORDER_SQL} DESC, id DESC
    `,
    [userId],
  )
  return result.rows.map(noteFromRow)
}

export function noteToMarkdown(note: Note): string {
  return encodeMarkdownNote(note)
}

export function markdownToNote(md: string, id?: string): Note {
  return decodeMarkdownNote(md, id)
}

export interface SyncPushItem {
  id: string
  markdown: string
  updatedAt: string
  baseVersion?: number
  version?: number
  contentHash?: string
  deleted?: boolean
}

export async function applySyncPush(userId: string, items: SyncPushItem[]): Promise<{ accepted: number; conflicts: string[] }> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    return store.applyLocalSyncPush(getLocalVaultRoot(), items)
  }

  const conflicts: string[] = []
  let accepted = 0

  for (const item of items) {
    const existing = await getNote(userId, item.id)
    if (existing && item.baseVersion !== undefined && item.baseVersion !== existing.version) {
      conflicts.push(item.id)
      continue
    }
    if (existing && item.baseVersion === undefined && existing.updatedAt > item.updatedAt) {
      conflicts.push(item.id)
      continue
    }

    const owner = await query<{ user_id: string }>(
      "SELECT user_id FROM notes WHERE id = $1 LIMIT 1",
      [item.id],
    )
    if (owner.rows[0] && owner.rows[0].user_id !== userId) {
      conflicts.push(item.id)
      continue
    }

    if (item.deleted) {
      try {
        if (await deleteNote(userId, item.id, item.baseVersion)) accepted++
      } catch (error) {
        if (error instanceof NoteWriteConflictError) {
          conflicts.push(item.id)
          continue
        }
        throw error
      }
      continue
    }

    const note = markdownToNote(item.markdown, item.id)
    if (item.contentHash && item.contentHash !== note.contentHash) {
      conflicts.push(item.id)
      continue
    }
    await ensureNotebook(userId, note.notebook, note.notebookIcon)
    const nextVersion = existing ? existing.version + 1 : (item.version ?? note.version)
    const contentHash = computeNoteContentHash(note)
    const sortOrder = noteSortOrder({ sortOrder: note.sortOrder, updatedAt: item.updatedAt })

    const upserted = existing
      ? await query<{ id: string }>(
          `
            UPDATE notes
            SET
              title = $1,
              excerpt = $2,
              notebook = $3,
              notebook_icon = $4,
              note_date = $5,
              starred = $6,
              tags = $7::jsonb,
              blocks = $8::jsonb,
              version = $9,
              content_hash = $10,
              sort_order = $11,
              updated_at = $12::timestamptz,
              deleted_at = NULL
            WHERE user_id = $13 AND id = $14 AND version = $15
            RETURNING id
          `,
          [
            note.title,
            note.excerpt,
            note.notebook,
            note.notebookIcon,
            note.date,
            note.starred,
            JSON.stringify(note.tags),
            JSON.stringify(note.blocks),
            nextVersion,
            contentHash,
            sortOrder,
            item.updatedAt,
            userId,
            note.id,
            existing.version,
          ],
        )
      : await query<{ id: string }>(
          `
            INSERT INTO notes (
              id, user_id, title, excerpt, notebook, notebook_icon, note_date, starred,
              tags, blocks, version, content_hash, sort_order, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15)
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `,
          [
            note.id,
            userId,
            note.title,
            note.excerpt,
            note.notebook,
            note.notebookIcon,
            note.date,
            note.starred,
            JSON.stringify(note.tags),
            JSON.stringify(note.blocks),
            nextVersion,
            contentHash,
            sortOrder,
            note.createdAt,
            item.updatedAt,
          ],
        )
    if ((upserted.rowCount ?? 0) === 0) {
      conflicts.push(item.id)
      continue
    }
    accepted++
  }

  return { accepted, conflicts }
}

export async function getSyncPull(userId: string, since?: string): Promise<Note[]> {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    const notes = store.listLocalNotes(getLocalVaultRoot(), { includeDeleted: true })
    return since ? notes.filter((note) => note.updatedAt > since) : notes
  }

  const result = await query<NoteRow>(
    `
      SELECT ${NOTE_SELECT_COLUMNS}
      FROM notes
      WHERE user_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2::timestamptz)
      ORDER BY updated_at ASC
    `,
    [userId, since ?? null],
  )
  return result.rows.map(noteFromRow)
}

export async function initializeWithSampleData(userId: string) {
  if (isLocalDesktopUser(userId)) {
    const store = await localVaultStore()
    const root = getLocalVaultRoot()
    const existing = store.listLocalNotes(root, { includeDeleted: true })
    if (existing.length > 0) return
    const first = store.createLocalNote(root, {
      title: "欢迎使用 Veil Notes",
      notebook: DEFAULT_NOTEBOOK_NAME,
      tags: ["本地仓库"],
      blocks: [
        { type: "paragraph", text: "这是本地仓库模式。笔记正文保存为 Markdown 文件，索引保存在 .veil/index.sqlite。" },
        { type: "todo", text: "开始写第一条笔记", checked: false },
      ],
    })
    store.saveLocalNote(root, { ...first, starred: true })
    return
  }

  const existing = await query<{ id: string }>("SELECT id FROM notes WHERE user_id = $1 LIMIT 1", [userId])
  if ((existing.rowCount ?? 0) > 0) return

  if (process.env.NODE_ENV === "production" && process.env.VEIL_SEED_SAMPLE_NOTES !== "true") {
    return
  }

  await ensureNotebook(userId, DEFAULT_NOTEBOOK_NAME, DEFAULT_NOTEBOOK_ICON)

  const notebooks: CreateNotebookInput[] = [
    { name: "每日日记", icon: DEFAULT_NOTEBOOK_ICON },
    { name: "工作笔记", icon: "Briefcase" },
    { name: "读书笔记", icon: "Library" },
    { name: "灵感收集", icon: "Lightbulb" },
    { name: "旅行日志", icon: "Plane" },
  ]
  for (const notebook of notebooks) {
    await createNotebook(userId, notebook)
  }

  const today = new Date().toISOString().slice(0, 10)
  const first = await createNote(userId, {
    title: "关于设计系统的思考",
    notebook: "每日日记",
    tags: ["设计系统", "Design Token"],
    blocks: [
      { type: "paragraph", text: "今天在搭建设计系统时，深刻体会到 token 架构的重要性。" },
      { type: "heading", text: "今日收获" },
      { type: "bullet", text: "三层 Token 架构：Seed → Semantic → Component" },
      { type: "heading", text: "待办" },
      { type: "todo", text: "完善颜色模式下的阴影系统", checked: true },
      { type: "todo", text: "补充固定 Token 文档", checked: false },
    ],
  })
  await updateNote(userId, first.id, { starred: true })

  await createNote(userId, {
    title: "Q2 OKR 复盘",
    notebook: "工作笔记",
    tags: ["OKR", "复盘"],
    blocks: [
      { type: "paragraph", text: "Q2 目标回顾，本次目标超额完成，产品增长达到预期。" },
      { type: "heading", text: "关键成果" },
      { type: "bullet", text: "月活跃用户增长 42%" },
    ],
  })

  await query("UPDATE notes SET note_date = $1 WHERE user_id = $2", [today, userId])
}
