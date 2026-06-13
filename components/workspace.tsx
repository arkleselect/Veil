"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { ArrowLeft, Bot, ChevronDown, ClipboardCopy, FileText, Info, Lightbulb, MoreHorizontal, Send, Share2, Sparkles, Star, Moon, Sun, UserRound } from "lucide-react"
import { Sidebar } from "@/components/sidebar"
import { NoteList } from "@/components/note-list"
import { Editor } from "@/components/editor"
import { AssetManager } from "@/components/asset-manager"
import { ChangePasswordForm } from "@/components/change-password-form"
import { SessionManager } from "@/components/session-manager"
import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { useToast } from "@/components/toast-provider"
import { useTheme } from "@/components/theme-provider"
import type { Note, Notebook, NotesPage, TagSummary, UpdateNoteInput, WorkspaceMode } from "@/lib/notes-data"
import { ApiError, askAiAssistant, getNote, getNotesPage, getNotebooks, getFavorites, getTrashNotes, getTagSummaries, updateNote, createNote, reorderNotes, deleteNote, restoreNote, emptyTrash, createNotebook, updateNotebook, deleteNotebook, logout, type AiAssistantContextNote } from "@/lib/api"
import { notebookShareUrl, shareOrCopyLink } from "@/lib/share"
import { cn } from "@/lib/utils"

const NOTES_PAGE_LIMIT = 50
const DEFAULT_DOCUMENT_TITLE = "我的笔记 · Notes"
const SIDEBAR_OPEN_STORAGE_KEY = "veil-sidebar-open"
const NOTE_LIST_OPEN_STORAGE_KEY = "veil-note-list-open"
const ACTIVE_NAV_STORAGE_KEY = "veil-active-nav"
const FAVORITE_NOTEBOOKS_STORAGE_KEY = "veil-favorite-notebook-ids"

function localRepositoryAvailable(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.runtime === "electron"
}

function storedBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback
  try {
    const value = window.localStorage.getItem(key)
    if (value === "true") return true
    if (value === "false") return false
  } catch {
    return fallback
  }
  return fallback
}

function storedActiveNav(): string {
  if (typeof window === "undefined") return "all"
  try {
    const value = window.localStorage.getItem(ACTIVE_NAV_STORAGE_KEY)
    return value && isValidStoredNav(value) ? value : "all"
  } catch {
    return "all"
  }
}

function isValidStoredNav(value: string): boolean {
  return ["all", "search", "today", "ai", "tags", "templates", "trash", "settings"].includes(value) ||
    value.startsWith("nb-") ||
    value.startsWith("tag-")
}

function viewFromNav(value: string): string | null {
  if (value === "ai" || value === "tags" || value === "templates" || value === "trash" || value === "settings") return value
  return null
}

function storedStringArray(key: string): string[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

interface WorkspaceProps {
  mode: WorkspaceMode
  onSwitchMode: () => void
}

interface NotesQuery {
  notebook?: string
  q?: string
  tag?: string
  date?: string
  starred?: boolean
}

function shouldShowNoteList(activeNav: string): boolean {
  return !["ai", "tags", "trash", "templates", "settings"].includes(activeNav)
}

function notesQueryFromNav(activeNav: string, searchQuery: string): NotesQuery {
  const query: NotesQuery = {}
  const q = searchQuery.trim()
  if (q) query.q = q
  if (activeNav === "today") query.date = "today"
  if (activeNav === "favorites") query.starred = true
  if (activeNav.startsWith("nb-")) query.notebook = activeNav.slice(3)
  if (activeNav.startsWith("tag-")) query.tag = activeNav.slice(4)
  return query
}

function conflictCurrentNote(error: unknown): Note | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const payload = error.payload
  if (!payload || typeof payload !== "object" || !("current" in payload)) return null
  const current = (payload as { current?: unknown }).current
  if (!current || typeof current !== "object" || !("id" in current) || !("version" in current)) return null
  return current as Note
}

function upsertNote(list: Note[], note: Note): Note[] {
  return list.some((item) => item.id === note.id)
    ? list.map((item) => (item.id === note.id ? note : item))
    : [note, ...list]
}

function mergeNoteCache(existing: Note[], incoming: Note[]): Note[] {
  const incomingById = new Map(incoming.map((note) => [note.id, note]))
  const existingIds = new Set(existing.map((note) => note.id))
  return [
    ...existing.map((note) => incomingById.get(note.id) ?? note),
    ...incoming.filter((note) => !existingIds.has(note.id)),
  ]
}

function appendUniqueIds(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing)
  return [
    ...existing,
    ...incoming.filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    }),
  ]
}

function reorderKnownIds(existing: string[], orderedIds: string[]): string[] {
  const existingSet = new Set(existing)
  const ordered = orderedIds.filter((id) => existingSet.has(id))
  if (ordered.length < 2) return existing

  const orderedSet = new Set(ordered)
  let nextOrderedIndex = 0
  return existing.map((id) => (
    orderedSet.has(id) ? ordered[nextOrderedIndex++] : id
  ))
}

function noteMatchesListQuery(note: Note, query: NotesQuery, notebooks: Notebook[]): boolean {
  if (query.notebook) {
    const notebook = notebooks.find((item) => item.id === query.notebook)
    if (!notebook || note.notebook !== notebook.name) return false
  }
  if (query.date) {
    const date = query.date === "today" ? new Date().toISOString().slice(0, 10) : query.date
    if (note.date !== date) return false
  }
  if (query.starred !== undefined && note.starred !== query.starred) return false
  if (query.tag && !note.tags.includes(query.tag)) return false
  if (query.q) {
    const q = query.q.toLowerCase()
    return (
      note.title.toLowerCase().includes(q) ||
      note.excerpt.toLowerCase().includes(q) ||
      note.notebook.toLowerCase().includes(q) ||
      note.tags.some((tag) => tag.toLowerCase().includes(q))
    )
  }
  return true
}

function updateInputForNote(data: Partial<Note>, baseVersion: number): UpdateNoteInput {
  return {
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.excerpt !== undefined ? { excerpt: data.excerpt } : {}),
    ...(data.notebook !== undefined ? { notebook: data.notebook } : {}),
    ...(data.notebookIcon !== undefined ? { notebookIcon: data.notebookIcon } : {}),
    ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
    ...(data.starred !== undefined ? { starred: data.starred } : {}),
    ...(data.tags !== undefined ? { tags: data.tags } : {}),
    ...(data.blocks !== undefined ? { blocks: data.blocks } : {}),
    ...(data.deletedAt !== undefined ? { deletedAt: data.deletedAt } : {}),
    baseVersion,
  }
}

interface HomeTreeItem {
  note: Note
  depth: number
  hasChildren: boolean
}

function flattenHomeNotes(notes: Note[], collapsedIds: string[] = []): HomeTreeItem[] {
  const byParent = new Map<string, Note[]>()
  const noteIds = new Set(notes.map((note) => note.id))
  const collapsed = new Set(collapsedIds)
  for (const note of notes) {
    const parentKey = note.parentId && noteIds.has(note.parentId) ? note.parentId : "__root__"
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), note])
  }

  const result: HomeTreeItem[] = []
  const visited = new Set<string>()
  const walk = (parentKey: string, depth: number) => {
    for (const note of byParent.get(parentKey) ?? []) {
      if (visited.has(note.id)) continue
      visited.add(note.id)
      const children = byParent.get(note.id) ?? []
      result.push({ note, depth, hasChildren: children.length > 0 })
      if (!collapsed.has(note.id)) walk(note.id, depth + 1)
    }
  }
  walk("__root__", 0)
  return result
}

function plainTextLength(note: Note): number {
  return note.title.length + note.blocks.reduce((total, block) => total + block.text.replace(/<[^>]*>/g, "").length, 0)
}

function stripBlockHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function assistantBlockText(note: Note): string {
  return note.blocks
    .map((block, index) => {
      const text = stripBlockHtml(block.text)
      if (!text) return ""
      if (block.type === "todo") return `${block.checked ? "[x]" : "[ ]"} ${text}`
      if (block.type === "bullet") return `- ${text}`
      if (block.type === "ordered") return `${index + 1}. ${text}`
      if (block.type === "quote") return `> ${text}`
      if (block.type === "code") return `代码:\n${text}`
      return text
    })
    .filter(Boolean)
    .join("\n")
}

function noteToAssistantContext(note: Note): AiAssistantContextNote {
  const content = assistantBlockText(note)
  return {
    title: note.title.trim() || "未命名笔记",
    excerpt: note.excerpt?.trim() || undefined,
    content: content ? content.slice(0, 12_000) : undefined,
    notebook: note.notebook || undefined,
  }
}

function assistantContextNotes(selectedNote: Note | null, notes: Note[]): Note[] {
  const seen = new Set<string>()
  const ordered = selectedNote ? [selectedNote, ...notes] : notes
  return ordered.filter((note) => {
    if (note.deletedAt || seen.has(note.id)) return false
    seen.add(note.id)
    return true
  }).slice(0, 8)
}

function formatHomeDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, "0")
  const today = new Date()
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  if (isToday) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function conflictCopyInput(note: Note, attempted: Partial<Note>): Parameters<typeof createNote>[0] {
  return {
    title: `${attempted.title ?? note.title}（冲突副本）`,
    notebook: attempted.notebook ?? note.notebook,
    notebookIcon: attempted.notebookIcon ?? note.notebookIcon,
    tags: attempted.tags ?? note.tags,
    blocks: attempted.blocks ?? note.blocks,
  }
}

function SidebarLayout({ sidebarOpen, sidebarWidth, mode, activeNav, handleNavChange, onSwitchMode, localRepositoryAvailable, setSidebarOpen, notebooks, favorites, handleSetView, handleCreateNotebook, handleRenameNotebook, handleUpdateNotebookIcon, handleDeleteNotebook, onLogout, onSidebarResize, children }: {
  sidebarOpen: boolean
  sidebarWidth: number
  mode: WorkspaceMode
  activeNav: string
  handleNavChange: (id: string) => void
  onSwitchMode: () => void
  localRepositoryAvailable: boolean
  setSidebarOpen: (v: boolean) => void
  notebooks: Notebook[]
  favorites: Note[]
  handleSetView: (view: string) => void
  handleCreateNotebook: (name: string) => void
  handleRenameNotebook: (id: string, name: string) => void
  handleUpdateNotebookIcon: (id: string, icon: string) => void | Promise<void>
  handleDeleteNotebook: (id: string, name: string) => boolean | Promise<boolean>
  onLogout: () => void
  onSidebarResize: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen w-full min-w-0 overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <>
          <div style={{ width: sidebarWidth }} className="min-w-0 shrink-0">
            <Sidebar
              mode={mode}
              activeNav={activeNav}
              onNavChange={handleNavChange}
              onSwitchMode={onSwitchMode}
              localRepositoryAvailable={localRepositoryAvailable}
              onToggleSidebar={() => setSidebarOpen(false)}
              notebooks={notebooks}
              favorites={favorites}
              onLogout={onLogout}
              onSetView={handleSetView}
              onCreateNotebook={handleCreateNotebook}
              onRenameNotebook={handleRenameNotebook}
              onUpdateNotebookIcon={handleUpdateNotebookIcon}
              onDeleteNotebook={handleDeleteNotebook}
            />
          </div>
          <ResizeHandle onMouseDown={onSidebarResize} />
        </>
      )}
      {children}
    </div>
  )
}

export function Workspace({ mode, onSwitchMode }: WorkspaceProps) {
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()
  const [activeNav, setActiveNav] = useState(() => storedActiveNav())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [titleNoteId, setTitleNoteId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => storedBoolean(SIDEBAR_OPEN_STORAGE_KEY, true))
  const [noteListOpen, setNoteListOpen] = useState(() => storedBoolean(NOTE_LIST_OPEN_STORAGE_KEY, true))
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [noteListWidth, setNoteListWidth] = useState(260)
  const [notes, setNotes] = useState<Note[]>([])
  const [noteIds, setNoteIds] = useState<string[]>([])
  const [notesCursor, setNotesCursor] = useState<string | undefined>()
  const [notesHasMore, setNotesHasMore] = useState(false)
  const [notesLoadingMore, setNotesLoadingMore] = useState(false)
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [favorites, setFavorites] = useState<Note[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const [currentView, setCurrentView] = useState<string | null>(() => viewFromNav(storedActiveNav()))
  const [trashNotes, setTrashNotes] = useState<Note[]>([])
  const [tagSummaries, setTagSummaries] = useState<TagSummary[]>([])
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const dragging = useRef<"sidebar" | "notelist" | null>(null)
  const startX = useRef(0)
  const startSidebarWidth = useRef(0)
  const startNoteListWidth = useRef(0)
  const notesRequestSeq = useRef(0)
  const notesRef = useRef<Note[]>([])
  const deepLinkAppliedRef = useRef(false)

  const listVisible = shouldShowNoteList(activeNav)
  const activeNotesQuery = useMemo(
    () => notesQueryFromNav(activeNav, debouncedSearchQuery),
    [activeNav, debouncedSearchQuery],
  )
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const displayNotes = useMemo(
    () => noteIds.map((id) => notesById.get(id)).filter((note): note is Note => Boolean(note)),
    [noteIds, notesById],
  )
  const selectedNote = selectedId ? notesById.get(selectedId) ?? null : null
  const titleNote = titleNoteId ? notesById.get(titleNoteId) ?? null : null
  const activeNotebookName = useMemo(() => {
    if (activeNav.startsWith("nb-")) {
      return notebooks.find((item) => item.id === activeNav.slice(3))?.name ?? "默认笔记本"
    }
    return displayNotes[0]?.notebook ?? notebooks[0]?.name ?? "默认笔记本"
  }, [activeNav, displayNotes, notebooks])
  const activeNotebook = useMemo(() => {
    if (!activeNav.startsWith("nb-")) return null
    return notebooks.find((item) => item.id === activeNav.slice(3)) ?? null
  }, [activeNav, notebooks])

  useEffect(() => {
    if (!activeNav.startsWith("nb-") || notebooks.length === 0) return
    if (notebooks.some((item) => item.id === activeNav.slice(3))) return
    setActiveNav("all")
    setCurrentView(null)
    setSelectedId(null)
    setTitleNoteId(null)
  }, [activeNav, notebooks])

  useEffect(() => {
    document.title = titleNote?.title ?? (activeNav.startsWith("nb-") ? activeNotebookName : DEFAULT_DOCUMENT_TITLE)
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE
    }
  }, [activeNav, activeNotebookName, titleNote])

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(sidebarOpen))
    } catch {
      // Ignore storage failures, for example private browsing restrictions.
    }
  }, [sidebarOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(NOTE_LIST_OPEN_STORAGE_KEY, String(noteListOpen))
    } catch {
      // Ignore storage failures, for example private browsing restrictions.
    }
  }, [noteListOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, activeNav)
    } catch {
      // Ignore storage failures, for example private browsing restrictions.
    }
  }, [activeNav])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 300)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    if (currentView === "trash") {
      getTrashNotes().then(setTrashNotes).catch(() => {})
    }
    if (currentView === "tags") {
      getTagSummaries().then(setTagSummaries).catch(() => {})
    }
  }, [currentView])

  const loadData = useCallback(async () => {
    const requestId = ++notesRequestSeq.current
    try {
      const query = notesQueryFromNav(activeNav, debouncedSearchQuery)
      const [notesPage, notebooksData, favoritesData, tagsData] = await Promise.all([
        shouldShowNoteList(activeNav)
          ? getNotesPage({ ...query, limit: NOTES_PAGE_LIMIT })
          : Promise.resolve<NotesPage>({ items: [], hasMore: false }),
        getNotebooks(),
        getFavorites(),
        getTagSummaries(),
      ])
      if (requestId !== notesRequestSeq.current) return

      setNotebooks(notebooksData)
      setFavorites(favoritesData)
      setTagSummaries(tagsData)
      setNotes((prev) => {
        const next = mergeNoteCache(prev, [...favoritesData, ...notesPage.items])
        notesRef.current = next
        return next
      })
      setNoteIds(notesPage.items.map((note) => note.id))
      setNotesCursor(notesPage.nextCursor)
      setNotesHasMore(notesPage.hasMore)
      const pageIds = new Set(notesPage.items.map((note) => note.id))
      setSelectedId((current) => {
        if (!shouldShowNoteList(activeNav)) return current
        if (current && pageIds.has(current)) return current
        return notesPage.items[0]?.id ?? null
      })
      setTitleNoteId((current) => (current && pageIds.has(current) ? current : null))
    } catch {
      toast("加载数据失败", "error")
    } finally {
      setLoading(false)
    }
  }, [activeNav, debouncedSearchQuery, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const ensureNoteLoaded = useCallback(async (id: string) => {
    if (notesById.has(id)) return
    try {
      const note = await getNote(id)
      setNotes((prev) => {
        const next = upsertNote(prev, note)
        notesRef.current = next
        return next
      })
    } catch {
      toast("加载笔记失败", "error")
    }
  }, [notesById, toast])

  const handleSelectNote = useCallback((id: string) => {
    setSelectedId(id)
    setTitleNoteId(id)
    setCurrentView(null)
    void ensureNoteLoaded(id)
  }, [ensureNoteLoaded])

  useEffect(() => {
    if (deepLinkAppliedRef.current) return
    deepLinkAppliedRef.current = true

    const params = new URLSearchParams(window.location.search)
    const noteId = params.get("note")
    const notebookId = params.get("notebook")
    const view = params.get("view")

    if (noteId) {
      setSelectedId(noteId)
      setTitleNoteId(noteId)
      setActiveNav(noteId)
      setCurrentView(null)
      void ensureNoteLoaded(noteId)
      return
    }

    if (notebookId) {
      setActiveNav(`nb-${notebookId}`)
      if (view === "home") setCurrentView("knowledge-home")
    }
  }, [ensureNoteLoaded])

  const handleLoadMoreNotes = useCallback(async () => {
    if (!listVisible || !notesHasMore || !notesCursor || notesLoadingMore) return
    setNotesLoadingMore(true)
    try {
      const page = await getNotesPage({
        ...activeNotesQuery,
        cursor: notesCursor,
        limit: NOTES_PAGE_LIMIT,
      })
      setNotes((prev) => {
        const next = mergeNoteCache(prev, page.items)
        notesRef.current = next
        return next
      })
      setNoteIds((prev) => appendUniqueIds(prev, page.items.map((note) => note.id)))
      setNotesCursor(page.nextCursor)
      setNotesHasMore(page.hasMore)
    } catch {
      toast("加载更多笔记失败", "error")
    } finally {
      setNotesLoadingMore(false)
    }
  }, [activeNotesQuery, listVisible, notesCursor, notesHasMore, notesLoadingMore, toast])

  const handleNavChange = useCallback((id: string) => {
    if (notesById.has(id) || favorites.some((note) => note.id === id)) {
      setSelectedId(id)
      setTitleNoteId(id)
      setActiveNav(id)
      setCurrentView(null)
      void ensureNoteLoaded(id)
      return
    }
    setTitleNoteId(null)
    if (id === "tags" || id === "trash" || id === "templates") {
      setSelectedId(null)
      setCurrentView(id)
      setActiveNav(id)
    } else if (id === "ai") {
      setCurrentView("ai")
      setActiveNav(id)
    } else {
      setSelectedId(null)
      setActiveNav(id)
      setCurrentView(null)
    }
  }, [ensureNoteLoaded, favorites, notesById])

  const handleSetView = useCallback((view: string) => {
    setCurrentView(view)
    setActiveNav(view)
  }, [])

  const onLogout = useCallback(async () => {
    try {
      await logout()
    } catch {
      // The local cleanup below is enough if the server session is already gone.
    }
    localStorage.removeItem("token")
    localStorage.removeItem("username")
    window.location.href = "/login"
  }, [])

  const handleMouseDown = useCallback((handle: "sidebar" | "notelist") => (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = handle
    startX.current = e.clientX
    startSidebarWidth.current = sidebarWidth
    startNoteListWidth.current = noteListWidth

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - startX.current
      if (dragging.current === "sidebar") {
        setSidebarWidth(Math.max(180, Math.min(400, startSidebarWidth.current + dx)))
      } else {
        setNoteListWidth(Math.max(200, Math.min(500, startNoteListWidth.current + dx)))
      }
    }

    const handleMouseUp = () => {
      dragging.current = null
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [sidebarWidth, noteListWidth])

  const handleCreateNotebook = useCallback((name: string) => {
    createNotebook({ name }).then((nb) => {
      setNotebooks((prev) => [...prev, nb])
      handleNavChange(`nb-${nb.id}`)
      toast(`已创建笔记本「${name}」`, "success")
    }).catch(() => toast("创建笔记本失败", "error"))
  }, [handleNavChange, toast])

  const handleRenameNotebook = useCallback(async (id: string, name: string) => {
    try {
      const updated = await updateNotebook(id, { name })
      setNotebooks((prev) => prev.map((n) => (n.id === id ? updated : n)))
      await loadData()
      toast(`已重命名为「${name}」`, "success")
    } catch {
      toast("重命名失败", "error")
    }
  }, [loadData, toast])

  const handleUpdateNotebookIcon = useCallback(async (id: string, icon: string) => {
    try {
      const updated = await updateNotebook(id, { icon })
      setNotebooks((prev) => prev.map((n) => (n.id === id ? updated : n)))
      setNotes((prev) => prev.map((note) => (
        note.notebook === updated.name ? { ...note, notebookIcon: updated.icon } : note
      )))
      await loadData()
    } catch {
      toast("更新图标失败", "error")
    }
  }, [loadData, toast])

  const handleDeleteNotebook = useCallback(async (id: string, name: string) => {
    try {
      await deleteNotebook(id)
      setNotebooks((prev) => prev.filter((n) => n.id !== id))
      await loadData()
      toast(`已删除笔记本「${name}」`, "success")
      return true
    } catch {
      toast(name === "默认笔记本" ? "默认笔记本仍有笔记，不能删除" : "删除笔记本失败", "error")
      return false
    }
  }, [loadData, toast])

  const canUseLocalRepository = localRepositoryAvailable()
  const handleSwitchMode = useCallback(() => {
    if (!localRepositoryAvailable() && mode !== "local") {
      toast("本地仓库只能在桌面端使用", "error")
      return
    }
    onSwitchMode()
  }, [mode, onSwitchMode, toast])

  const sidebarProps = {
    sidebarOpen,
    sidebarWidth,
    mode,
    activeNav,
    handleNavChange,
    onSwitchMode: handleSwitchMode,
    localRepositoryAvailable: canUseLocalRepository,
    setSidebarOpen,
    notebooks,
    favorites,
    handleSetView,
    handleCreateNotebook,
    handleRenameNotebook,
    handleUpdateNotebookIcon,
    handleDeleteNotebook,
    onLogout,
    onSidebarResize: handleMouseDown("sidebar"),
  }

  const applyCurrentNote = useCallback((current: Note) => {
    setNotes((prev) => {
      const next = current.deletedAt ? prev.filter((n) => n.id !== current.id) : upsertNote(prev, current)
      notesRef.current = next
      return next
    })
    setNoteIds((prev) => {
      if (current.deletedAt || !noteMatchesListQuery(current, activeNotesQuery, notebooks)) {
        return prev.filter((id) => id !== current.id)
      }
      return prev.includes(current.id) ? prev : [current.id, ...prev]
    })
    setFavorites((prev) => {
      if (current.deletedAt || !current.starred) return prev.filter((n) => n.id !== current.id)
      return upsertNote(prev, current)
    })
    setTrashNotes((prev) => current.deletedAt ? upsertNote(prev, current) : prev.filter((n) => n.id !== current.id))
  }, [activeNotesQuery, notebooks])

  const handleNoteConflict = useCallback(async (
    error: unknown,
    fallbackMessage: string,
    attempted?: { note: Note; data: Partial<Note> },
  ): Promise<Note | null> => {
    const current = conflictCurrentNote(error)
    if (!current) {
      toast(fallbackMessage, "error")
      return null
    }

    let conflictCopy: Note | null = null
    if (attempted && !attempted.note.deletedAt) {
      try {
        conflictCopy = await createNote(conflictCopyInput(attempted.note, attempted.data))
      } catch {
        conflictCopy = null
      }
    }

    applyCurrentNote(current)
    if (conflictCopy) {
      setNotes((prev) => {
        const next = upsertNote(prev, conflictCopy)
        notesRef.current = next
        return next
      })
      if (noteMatchesListQuery(conflictCopy, activeNotesQuery, notebooks)) {
        setNoteIds((prev) => appendUniqueIds([conflictCopy.id], prev))
      }
    }
    if (typeof document !== "undefined") {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
    }
    await loadData()
    if (currentView === "trash") {
      getTrashNotes().then(setTrashNotes).catch(() => {})
    }
    toast(
      conflictCopy
        ? "这篇笔记已被其他设备更新，已保留本地修改为冲突副本"
        : "这篇笔记已被其他设备更新，已加载最新版本",
      "info",
    )
    return current
  }, [activeNotesQuery, applyCurrentNote, currentView, loadData, notebooks, toast])

  const handleUpdateNote = useCallback(async (id: string, data: Partial<Note>) => {
    const current = notesRef.current.find((n) => n.id === id)
    if (!current) {
      toast("笔记不存在或已被删除", "error")
      throw new Error("Note not found in local state")
    }

    try {
      const updated = await updateNote(id, updateInputForNote(data, current.version))
      applyCurrentNote(updated)
      return updated
    } catch (error) {
      const conflict = await handleNoteConflict(error, "保存笔记失败", { note: current, data })
      if (conflict) return conflict
      throw error
    }
  }, [applyCurrentNote, handleNoteConflict, toast])

  const handleStar = useCallback(async (id: string, starred: boolean) => {
    try {
      await handleUpdateNote(id, { starred })
    } catch {
      // handleUpdateNote already reports the failure.
    }
  }, [handleUpdateNote])

  const handleRenameNote = useCallback(async (id: string, title: string) => {
    try {
      await handleUpdateNote(id, { title })
      toast(`已重命名为「${title}」`, "success")
    } catch {
      // handleUpdateNote already reports the failure.
    }
  }, [handleUpdateNote, toast])

  const handleReorderNotes = useCallback(async (orderedIds: string[]) => {
    const uniqueIds = Array.from(new Set(orderedIds))
    if (uniqueIds.length < 2) return

    const optimisticSortOrder = Date.now()
    const sortOrderById = new Map(uniqueIds.map((id, index) => [id, optimisticSortOrder - index]))
    setNoteIds((prev) => reorderKnownIds(prev, uniqueIds))
    setNotes((prev) => {
      const next = prev.map((note) => {
        const sortOrder = sortOrderById.get(note.id)
        return sortOrder === undefined ? note : { ...note, sortOrder }
      })
      notesRef.current = next
      return next
    })

    try {
      const updated = await reorderNotes(uniqueIds)
      if (updated.length) {
        setNotes((prev) => {
          const next = mergeNoteCache(prev, updated)
          notesRef.current = next
          return next
        })
      }
    } catch {
      toast("调整笔记顺序失败", "error")
      await loadData()
    }
  }, [loadData, toast])

  const handleCreateNote = useCallback(async (parentId?: string) => {
    try {
      const parent = parentId ? notesRef.current.find((item) => item.id === parentId) : null
      const note = await createNote({
        title: "新笔记",
        ...(parent ? {
          parentId: parent.id,
          notebook: parent.notebook,
          notebookIcon: parent.notebookIcon,
        } : activeNotebook ? {
          notebook: activeNotebook.name,
          notebookIcon: activeNotebook.icon,
        } : {}),
      })
      setNotes((prev) => {
        const next = [note, ...prev]
        notesRef.current = next
        return next
      })
      setNotebooks((prev) => prev.map((item) => (
        item.name === note.notebook ? { ...item, count: item.count + 1 } : item
      )))
      if (noteMatchesListQuery(note, activeNotesQuery, notebooks)) {
        setNoteIds((prev) => appendUniqueIds([note.id], prev))
      }
      setSelectedId(note.id)
      toast("已创建新笔记", "success")
    } catch {
      toast("创建笔记失败", "error")
    }
  }, [activeNotebook, activeNotesQuery, notebooks, toast])

  const handleDeleteNote = useCallback(async (id: string) => {
    const current = notesRef.current.find((n) => n.id === id)
    if (!current) {
      toast("笔记不存在或已被删除", "error")
      return
    }

    try {
      await deleteNote(id, current.version)
      const nextNoteIds = noteIds.filter((noteId) => noteId !== id)
      setNotes((prev) => {
        const next = prev.filter((n) => n.id !== id)
        notesRef.current = next
        return next
      })
      setNoteIds(nextNoteIds)
      setFavorites((prev) => prev.filter((n) => n.id !== id))
      if (selectedId === id) setSelectedId(nextNoteIds[0] ?? null)
      if (titleNoteId === id) setTitleNoteId(nextNoteIds[0] ?? null)
    } catch (error) {
      await handleNoteConflict(error, "删除笔记失败")
    }
  }, [handleNoteConflict, noteIds, selectedId, titleNoteId, toast])

  const handleDeleteNotes = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids))
    if (!uniqueIds.length) return

    const notesByLocalId = new Map(notesRef.current.map((note) => [note.id, note]))
    const targets = uniqueIds
      .map((id) => notesByLocalId.get(id))
      .filter((note): note is Note => Boolean(note))

    if (!targets.length) {
      toast("笔记不存在或已被删除", "error")
      return
    }

    const deletedIds: string[] = []
    let failedCount = uniqueIds.length - targets.length

    for (const note of targets) {
      try {
        await deleteNote(note.id, note.version)
        deletedIds.push(note.id)
      } catch (error) {
        failedCount += 1
        await handleNoteConflict(error, `删除「${note.title}」失败`)
      }
    }

    if (deletedIds.length) {
      const deletedIdSet = new Set(deletedIds)
      const nextNoteIds = noteIds.filter((noteId) => !deletedIdSet.has(noteId))
      const nextSelectedId = nextNoteIds[0] ?? null

      setNotes((prev) => {
        const next = prev.filter((note) => !deletedIdSet.has(note.id))
        notesRef.current = next
        return next
      })
      setNoteIds(nextNoteIds)
      setFavorites((prev) => prev.filter((note) => !deletedIdSet.has(note.id)))
      if (selectedId && deletedIdSet.has(selectedId)) setSelectedId(nextSelectedId)
      if (titleNoteId && deletedIdSet.has(titleNoteId)) setTitleNoteId(nextSelectedId)
    }

    if (deletedIds.length && failedCount > 0) {
      toast(`已删除 ${deletedIds.length} 篇，${failedCount} 篇删除失败`, "info")
      return
    }
    if (deletedIds.length) {
      toast(`已删除 ${deletedIds.length} 篇笔记`, "success")
      return
    }
    toast("删除笔记失败", "error")
  }, [handleNoteConflict, noteIds, selectedId, titleNoteId, toast])

  const handleHomeSelect = useCallback(() => {
    setTitleNoteId(null)
    setCurrentView("knowledge-home")
  }, [])

  const handleDirectorySelect = useCallback(() => {
    setTitleNoteId(null)
    setCurrentView(null)
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    )
  }

  const layout = (content: React.ReactNode) => (
    <SidebarLayout {...sidebarProps}>{content}</SidebarLayout>
  )

  if (currentView === "tags") {
    return layout(
      <div className="flex flex-1 items-start overflow-y-auto px-8 py-12 lg:pl-12 lg:pr-10">
        <div className="w-full max-w-3xl">
          <h2 className="text-lg font-semibold text-foreground">标签管理</h2>
          <p className="mt-1 text-sm text-muted-foreground">共 {tagSummaries.length} 个标签</p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            {tagSummaries.length === 0 && (
              <p className="col-span-2 text-sm text-muted-foreground">暂无标签，给笔记添加标签后可以在这里管理。</p>
            )}
            {tagSummaries.map((tag) => (
              <div key={tag.name} className="group flex min-w-0 items-center gap-3 rounded-lg border border-border px-4 py-3">
                <button
                  onClick={() => handleNavChange(`tag-${tag.name}`)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="truncate text-sm font-medium text-foreground">{tag.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{tag.count} 篇</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (currentView === "trash") {
    return layout(
      <>
        <div className="flex flex-1 flex-col overflow-y-auto px-8 py-12 lg:pl-12 lg:pr-10">
          <div className="w-full max-w-3xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">回收站</h2>
                <p className="mt-1 text-sm text-muted-foreground">共 {trashNotes.length} 篇已删除的笔记</p>
              </div>
              {trashNotes.length > 0 && (
                <button
                  onClick={() => setEmptyTrashOpen(true)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  清空回收站
                </button>
              )}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2">
              {trashNotes.length === 0 && (
                <p className="col-span-2 text-sm text-muted-foreground">回收站是空的。</p>
              )}
              {trashNotes.map((n) => (
                <div key={n.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">{n.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{n.notebook} · {n.date}</span>
                  </div>
	                  <button
	                    onClick={async () => {
	                      try {
	                        const restored = await restoreNote(n.id, n.version)
	                        if (restored) {
	                          setTrashNotes((prev) => prev.filter((t) => t.id !== n.id))
	                          applyCurrentNote(restored)
	                          toast(`已恢复「${n.title}」`, "success")
	                          await loadData()
	                        }
	                      } catch (error) {
	                        await handleNoteConflict(error, "恢复笔记失败")
	                      }
	                    }}
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <ConfirmDialog
          open={emptyTrashOpen}
          onClose={() => setEmptyTrashOpen(false)}
          onConfirm={async () => {
            try {
              const result = await emptyTrash()
              setTrashNotes([])
              toast(`已清空回收站，删除了 ${result.deleted} 篇笔记`, "success")
              loadData()
            } catch {
              toast("清空回收站失败", "error")
            }
          }}
          title="清空回收站"
          message="确定永久清空回收站？此操作不可撤销。"
          confirmText="清空"
          destructive
        />
      </>
    )
  }

  if (currentView === "templates") {
    const templates = [
      { title: "会议记录", content: "## 会议主题\n\n**时间**：\n**参与者**：\n\n### 议程\n- \n\n### 行动项\n- [ ] " },
      { title: "每日日记", content: "## 今日日期\n\n### 今日完成\n- \n\n### 明日计划\n- \n\n### 感想\n" },
      { title: "读书笔记", content: "## 书名\n\n**作者**：\n\n### 核心观点\n\n### 金句摘抄\n> \n\n### 个人思考\n" },
    ]
    return layout(
      <div className="flex flex-1 items-start overflow-y-auto px-8 py-12 lg:pl-12 lg:pr-10">
        <div className="w-full max-w-3xl">
          <h2 className="text-lg font-semibold text-foreground">模板中心</h2>
          <p className="mt-1 text-sm text-muted-foreground">选择一个模板快速创建笔记</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {templates.map((t) => (
              <button
                key={t.title}
                onClick={async () => {
                  try {
                    const note = await createNote({
                      title: t.title,
                      blocks: [{ type: "paragraph" as const, text: t.content }],
                    })
                    setNotes((prev) => {
                      const next = [note, ...prev]
                      notesRef.current = next
                      return next
                    })
                    setSelectedId(note.id)
                    setCurrentView(null)
                    setActiveNav("all")
                    toast(`已创建「${t.title}」`, "success")
                  } catch {
                    toast("创建笔记失败", "error")
                  }
                }}
                className="group flex min-w-0 items-center gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-accent"
              >
                <span className="truncate text-sm font-medium text-foreground">{t.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">使用模板</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (currentView === "settings") {
    return layout(
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="app-drag-region desktop-window-control-spacer flex h-14 shrink-0 items-center border-b border-border px-4">
          <button
            type="button"
            onClick={() => {
              setCurrentView(null)
              setActiveNav("all")
            }}
            aria-label="返回"
            className="app-no-drag flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 items-start justify-center overflow-y-auto py-10">
          <div className="w-full max-w-2xl px-6">
            <h2 className="text-lg font-semibold text-foreground">设置</h2>
            <p className="mt-1 text-sm text-muted-foreground">应用偏好设置</p>
            <div className="mt-6 flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">主题</p>
                  <p className="text-xs text-muted-foreground mt-0.5">切换深色/浅色模式</p>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-sidebar-accent p-0.5">
                  <button
                    type="button"
                    onClick={() => setTheme("light")}
                    aria-label="浅色模式"
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                      theme === "light"
                        ? "bg-card text-sidebar-foreground shadow-sm"
                        : "text-muted-foreground hover:text-sidebar-foreground",
                    )}
                  >
                    <Sun className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme("dark")}
                    aria-label="深色模式"
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                      theme === "dark"
                        ? "bg-card text-sidebar-foreground shadow-sm"
                        : "text-muted-foreground hover:text-sidebar-foreground",
                    )}
                  >
                    <Moon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">语言</p>
                  <p className="text-xs text-muted-foreground mt-0.5">当前：简体中文</p>
                </div>
              </div>
              {mode === "cloud" && (
                <>
                  <ChangePasswordForm />
                  <SessionManager />
                </>
              )}
              <AssetManager />
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">版本</p>
                  <p className="text-xs text-muted-foreground mt-0.5">1.0.0</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (currentView === "ai" || activeNav === "ai") {
    return layout(
      <AIAssistant
        selectedNote={selectedNote}
        notes={displayNotes.length ? displayNotes : notes}
        activeNotebookName={activeNotebookName}
        onSelectNote={handleSelectNote}
      />,
    )
  }

  return layout(
    <>
      {noteListOpen && (
        <>
          <div style={{ width: noteListWidth }} className="min-w-0 shrink-0">
            <NoteList
              notes={displayNotes}
              selectedId={selectedId}
              onSelect={handleSelectNote}
              onCreateNote={handleCreateNote}
              onDeleteNote={handleDeleteNote}
              onDeleteNotes={handleDeleteNotes}
              onRenameNote={handleRenameNote}
              onStarNote={handleStar}
              onReorderNotes={handleReorderNotes}
              notebookName={activeNotebookName}
              noteCount={displayNotes.length}
              homeActive={currentView === "knowledge-home"}
              onHomeSelect={handleHomeSelect}
              directoryActive={currentView !== "knowledge-home"}
              onDirectorySelect={handleDirectorySelect}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              hasMore={listVisible && notesHasMore}
              loadingMore={notesLoadingMore}
              onLoadMore={handleLoadMoreNotes}
              reserveWindowControls={!sidebarOpen}
            />
          </div>
          <ResizeHandle onMouseDown={handleMouseDown("notelist")} />
        </>
      )}
      {currentView === "knowledge-home" ? (
        <KnowledgeHome
          notes={displayNotes}
          notebooks={notebooks}
          activeNav={activeNav}
          onSelectNote={handleSelectNote}
        />
      ) : (
        <Editor
          note={selectedNote}
          sidebarOpen={sidebarOpen}
          noteListOpen={noteListOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleNoteList={() => setNoteListOpen((v) => !v)}
          onUpdateNote={handleUpdateNote}
        />
      )}
    </>
  )
}

function AIAssistant({
  selectedNote,
  notes,
  activeNotebookName,
  onSelectNote,
}: {
  selectedNote: Note | null
  notes: Note[]
  activeNotebookName: string
  onSelectNote: (id: string) => void
}) {
  const { toast } = useToast()
  const [prompt, setPrompt] = useState("")
  const [answer, setAnswer] = useState("")
  const [suggestions, setSuggestions] = useState<string[]>(["总结当前内容", "提炼待办事项", "生成复习提纲"])
  const [source, setSource] = useState<"ai" | "local" | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contextNotes = useMemo(() => assistantContextNotes(selectedNote, notes), [selectedNote, notes])
  const contextPayload = useMemo(() => contextNotes.map(noteToAssistantContext), [contextNotes])
  const contextTitle = selectedNote?.title || activeNotebookName
  const quickActions = useMemo(() => [
    {
      label: "总结当前内容",
      icon: Sparkles,
      prompt: selectedNote ? "请总结当前笔记，列出核心观点和遗漏风险。" : `请总结「${activeNotebookName}」里的笔记重点。`,
    },
    {
      label: "提炼待办事项",
      icon: Lightbulb,
      prompt: "请从这些笔记中提炼可执行的待办事项，并按优先级排列。",
    },
    {
      label: "生成复习提纲",
      icon: FileText,
      prompt: "请把这些笔记整理成一份清晰的复习提纲。",
    },
  ], [activeNotebookName, selectedNote])

  const submitAssistant = useCallback(async (messageOverride?: string) => {
    const message = (messageOverride ?? prompt).trim()
    if (!message || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await askAiAssistant({ message, context: contextPayload })
      setAnswer(result.answer)
      setSource(result.source)
      setSuggestions(result.suggestions)
      if (!messageOverride) setPrompt("")
    } catch {
      setError("AI 助手暂时不可用，请稍后再试。")
    } finally {
      setLoading(false)
    }
  }, [contextPayload, loading, prompt])

  const copyAnswer = useCallback(async () => {
    if (!answer) return
    try {
      await navigator.clipboard.writeText(answer)
      toast("已复制", "success")
    } catch {
      toast("复制失败", "error")
    }
  }, [answer, toast])

  return (
    <section className="flex min-w-0 flex-1 overflow-hidden bg-[#f6f7f8] text-foreground dark:bg-background">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="flex min-w-0 flex-col overflow-hidden border-r border-border bg-background/95">
          <div className="flex min-h-[72px] items-center justify-between gap-4 border-b border-border px-6 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#e8f2ff] text-[#2563eb] dark:bg-[#17345f] dark:text-[#9bc7ff]">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h1 className="truncate text-[18px] font-semibold leading-6">AI 助手</h1>
                  <p className="truncate text-xs text-muted-foreground">{contextTitle}</p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-[6px] border border-border px-2 py-1">{contextPayload.length} 篇上下文</span>
              {source && (
                <span className={cn(
                  "rounded-[6px] border px-2 py-1",
                  source === "ai"
                    ? "border-[#b7d5ff] bg-[#eef6ff] text-[#1d4ed8] dark:border-[#244b80] dark:bg-[#102744] dark:text-[#9bc7ff]"
                    : "border-[#d7dce2] bg-muted text-muted-foreground",
                )}>
                  {source === "ai" ? "AI 生成" : "本地整理"}
                </span>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {quickActions.map((action) => {
                const Icon = action.icon
                return (
                  <button
                    key={action.label}
                    type="button"
                    disabled={loading}
                    onClick={() => { void submitAssistant(action.prompt) }}
                    className="flex min-h-[76px] items-start gap-3 rounded-[8px] border border-border bg-card px-4 py-3 text-left transition-colors hover:border-[#9bc7ed] hover:bg-[#f8fbff] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#10243a]"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#2563eb] dark:text-[#9bc7ff]" />
                    <span className="text-sm font-medium leading-5">{action.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="mt-5 rounded-[8px] border border-border bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-[#2563eb] dark:text-[#9bc7ff]" />
                  <span className="truncate text-sm font-medium">回答</span>
                </div>
                <button
                  type="button"
                  aria-label="复制回答"
                  title="复制回答"
                  disabled={!answer}
                  onClick={() => { void copyAnswer() }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ClipboardCopy className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-[280px] px-5 py-5">
                {loading ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">
                    正在整理...
                  </div>
                ) : answer ? (
                  <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-7 text-foreground">{answer}</pre>
                ) : (
                  <div className="flex min-h-[220px] flex-col justify-center gap-3 text-sm text-muted-foreground">
                    <p>可以直接提问，也可以从上方选择一个动作。</p>
                    {contextPayload.length === 0 && <p>当前没有可用笔记上下文。</p>}
                  </div>
                )}
                {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
                {answer && suggestions.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {suggestions.map((item) => (
                      <button
                        key={item}
                        type="button"
                        disabled={loading}
                        onClick={() => { void submitAssistant(item) }}
                        className="rounded-[6px] border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <form
            className="border-t border-border bg-background px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submitAssistant()
            }}
          >
            <div className="flex items-end gap-3 rounded-[8px] border border-border bg-card p-2 focus-within:border-[#8bbcf0]">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault()
                    void submitAssistant()
                  }
                }}
                placeholder="向 AI 助手提问..."
                rows={2}
                className="max-h-40 min-h-[48px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                aria-label="发送"
                title="发送"
                disabled={loading || !prompt.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#2563eb] text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </main>

        <aside className="min-h-0 overflow-y-auto bg-[#fbfbfa] px-5 py-5 dark:bg-card/70">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">上下文</h2>
              <p className="truncate text-xs text-muted-foreground">{activeNotebookName}</p>
            </div>
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>

          <div className="space-y-2">
            {contextNotes.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                暂无可用笔记。
              </div>
            ) : contextNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => onSelectNote(note.id)}
                className={cn(
                  "w-full rounded-[8px] border border-border bg-background px-3 py-3 text-left transition-colors hover:border-[#9bc7ed] hover:bg-[#f8fbff] dark:hover:bg-[#10243a]",
                  selectedNote?.id === note.id && "border-[#9bc7ed] bg-[#eef6ff] dark:border-[#244b80] dark:bg-[#102744]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">{note.title || "未命名笔记"}</span>
                  <span className="shrink-0 rounded-[6px] bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{note.notebook}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {note.excerpt || stripBlockHtml(note.blocks[0]?.text ?? "") || "空笔记"}
                </p>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}

function KnowledgeHome({
  notes,
  notebooks,
  activeNav,
  onSelectNote,
}: {
  notes: Note[]
  notebooks: Notebook[]
  activeNav: string
  onSelectNote: (id: string) => void
}) {
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  const activeNotebook = activeNav.startsWith("nb-")
    ? notebooks.find((item) => item.id === activeNav.slice(3))
    : notebooks.find((item) => item.name === notes[0]?.notebook) ?? notebooks[0]
  const title = activeNotebook?.name ?? "默认知识库"
  const treeItems = flattenHomeNotes(notes, collapsedIds)
  const wordCount = notes.reduce((total, note) => total + plainTextLength(note), 0)
  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => prev.includes(id)
      ? prev.filter((item) => item !== id)
      : [...prev, id])
  }

  return (
    <section className="flex min-w-0 flex-1 justify-center overflow-y-auto bg-[#f6f7f8] pb-14 pl-20 pr-24 pt-14 dark:bg-background xl:pl-28 xl:pr-20">
      <div className="min-h-[calc(100vh-112px)] w-full max-w-[1120px] rounded-[12px] bg-white px-14 pb-16 pt-14 dark:bg-card">
        <div className="flex items-start justify-between gap-10">
          <div className="min-w-0">
            <h1 className="truncate text-[30px] font-semibold leading-[42px] text-foreground">{title}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-9 text-[15px] leading-6 text-muted-foreground">
              <span><strong className="mr-1.5 text-[22px] font-semibold leading-none text-foreground">{notes.length}</strong>文档</span>
              <span className="inline-flex items-center gap-2">
                <span><strong className="mr-1.5 text-[22px] font-semibold leading-none text-foreground">{wordCount}</strong>字</span>
                <Info className="h-3.5 w-3.5 text-muted-foreground/70" />
              </span>
            </div>
            <div className="mt-8 flex h-8 w-8 items-center justify-center rounded-full bg-muted/70 text-muted-foreground/45">
              <UserRound className="h-5 w-5" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <button type="button" aria-label="收藏" title="收藏" className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-border bg-background text-foreground transition-colors hover:bg-card">
              <Star className="h-4 w-4" />
            </button>
            <button type="button" aria-label="分享" title="分享" className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-border bg-background text-foreground transition-colors hover:bg-card">
              <Share2 className="h-4 w-4" />
            </button>
            <button type="button" aria-label="更多" title="更多" className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-border bg-background text-foreground transition-colors hover:bg-card">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-28">
          {treeItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无文档</p>
          ) : treeItems.map(({ note, depth, hasChildren }) => (
            <div key={note.id} className="group -mx-3 rounded-[6px] px-3 transition-colors hover:bg-card/70">
              <div className="grid h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-5 text-[15px] text-foreground">
                <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 32}px` }}>
                  <button
                    type="button"
                    disabled={!hasChildren}
                    aria-label={collapsedIds.includes(note.id) ? "展开子笔记" : "收起子笔记"}
                    aria-expanded={hasChildren ? !collapsedIds.includes(note.id) : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (hasChildren) toggleCollapsed(note.id)
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-0"
                  >
                    {hasChildren && (
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", collapsedIds.includes(note.id) && "-rotate-90")} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectNote(note.id)}
                    className="min-w-0 max-w-[min(34rem,72%)] shrink-0 truncate text-left leading-10 text-foreground transition-colors hover:text-foreground/75"
                  >
                    {note.title}
                  </button>
                  <span className="min-w-8 flex-1 translate-y-px border-b border-dashed border-[#e5e8e6] dark:border-border/70" />
                </div>
                <span className="shrink-0 text-[15px] text-muted-foreground">{formatHomeDate(note.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="app-no-drag relative w-0 shrink-0 cursor-col-resize"
    >
      <div className="absolute inset-y-0 -left-2 -right-2 z-10 bg-transparent" />
    </div>
  )
}
