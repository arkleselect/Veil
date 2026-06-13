export type WorkspaceMode = "local" | "cloud"

export const DEFAULT_NOTEBOOK_NAME = "默认笔记本"
export const DEFAULT_NOTEBOOK_ICON = "BookOpen"

export type HeadingLevel = 1 | 2 | 3

export interface Notebook {
  id: string
  name: string
  icon: string
  count: number
  createdAt: string
}

export interface NoteBlock {
  type: "paragraph" | "heading" | "bullet" | "todo" | "ordered" | "quote" | "code" | "highlight" | "columns" | "toggle"
  text: string
  checked?: boolean
  level?: HeadingLevel
  collapsed?: boolean
  showLineNumbers?: boolean
  toggleId?: string
  toggleParentId?: string
}

export interface Note {
  id: string
  title: string
  excerpt: string
  notebook: string
  notebookIcon: string
  parentId?: string
  date: string
  starred: boolean
  tags: string[]
  blocks: NoteBlock[]
  version: number
  contentHash: string
  sortOrder?: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface CreateNoteInput {
  title?: string
  notebook?: string
  notebookIcon?: string
  parentId?: string
  tags?: string[]
  blocks?: NoteBlock[]
}

export interface UpdateNoteInput {
  title?: string
  excerpt?: string
  notebook?: string
  notebookIcon?: string
  parentId?: string | null
  starred?: boolean
  tags?: string[]
  blocks?: NoteBlock[]
  deletedAt?: string | null
  baseVersion?: number
}

export interface NotesPage {
  items: Note[]
  nextCursor?: string
  hasMore: boolean
}

export interface TagSummary {
  name: string
  count: number
}

export interface CreateNotebookInput {
  name: string
  icon?: string
}
