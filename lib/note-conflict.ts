import type { Note } from "@/lib/notes-data"

export class NoteWriteConflictError extends Error {
  current: Note

  constructor(current: Note) {
    super("笔记已被其他设备更新")
    this.name = "NoteWriteConflictError"
    this.current = current
  }
}
