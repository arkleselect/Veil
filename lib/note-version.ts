import { createHash } from "crypto"
import type { Note } from "@/lib/notes-data"

type HashableNote = Pick<
  Note,
  "title" | "excerpt" | "notebook" | "notebookIcon" | "date" | "starred" | "tags" | "blocks" | "deletedAt"
  | "parentId"
>

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`
}

export function noteContentFingerprint(note: HashableNote): string {
  return stableStringify({
    title: note.title,
    excerpt: note.excerpt,
    notebook: note.notebook,
    notebookIcon: note.notebookIcon,
    parentId: note.parentId ?? null,
    date: note.date,
    starred: note.starred,
    tags: note.tags,
    blocks: note.blocks,
    deletedAt: note.deletedAt ?? null,
  })
}

export function computeNoteContentHash(note: HashableNote): string {
  return createHash("sha256").update(noteContentFingerprint(note)).digest("hex")
}

export function withNoteContentHash<T extends HashableNote>(note: T): T & { contentHash: string } {
  return {
    ...note,
    contentHash: computeNoteContentHash(note),
  }
}
