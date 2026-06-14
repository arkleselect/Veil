"use client"

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { Search, X, List, LayoutGrid, Plus, Star, Trash2, MoreHorizontal, Copy, ChevronDown, ChevronRight, Home, Check, LocateFixed, Pencil, FileText, Upload } from "lucide-react"
import type { Note } from "@/lib/notes-data"
import { cn } from "@/lib/utils"
import { PromptDialog } from "@/components/dialog"

type NoteListView = "card" | "compact"

interface NoteListProps {
  notes: Note[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateNote: (parentId?: string) => void
  onDeleteNote: (id: string) => void
  onDeleteNotes: (ids: string[]) => void | Promise<void>
  onRenameNote: (id: string, title: string) => void | Promise<void>
  onStarNote: (id: string, starred: boolean) => void
  onReorderNotes?: (orderedIds: string[]) => void | Promise<void>
  notebookName?: string
  noteCount?: number
  homeActive?: boolean
  onHomeSelect?: () => void
  directoryActive?: boolean
  onDirectorySelect?: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  reserveWindowControls?: boolean
}

const NOTE_LIST_VIEW_KEY = "veil-note-list-view"

interface NoteTreeItem {
  note: Note
  depth: number
  hasChildren: boolean
}

interface NoteSelectionInput {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

type DragOverPosition = "before" | "after"

export function NoteList({
  notes,
  selectedId,
  onSelect,
  onCreateNote,
  onDeleteNote,
  onDeleteNotes,
  onRenameNote,
  onStarNote,
  onReorderNotes,
  notebookName = "默认笔记本",
  noteCount = notes.length,
  homeActive = false,
  onHomeSelect,
  directoryActive = false,
  onDirectorySelect,
  searchQuery,
  onSearchChange,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  reserveWindowControls = false,
}: NoteListProps) {
  const [view, setView] = useState<NoteListView>("compact")
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [renamingNote, setRenamingNote] = useState<Note | null>(null)
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [deletingSelected, setDeletingSelected] = useState(false)
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null)
  const [dragOverNote, setDragOverNote] = useState<{ id: string; position: DragOverPosition } | null>(null)
  const viewMenuRef = useRef<HTMLDivElement | null>(null)
  const draggingNoteIdRef = useRef<string | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem(NOTE_LIST_VIEW_KEY)
    if (saved === "card" || saved === "compact") setView(saved)
  }, [])

  const changeView = (nextView: NoteListView) => {
    setView(nextView)
    localStorage.setItem(NOTE_LIST_VIEW_KEY, nextView)
    setViewMenuOpen(false)
  }

  useEffect(() => {
    if (!viewMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!viewMenuRef.current?.contains(event.target as Node)) setViewMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewMenuOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [viewMenuOpen])

  const treeItems = useMemo(() => flattenNoteTree(notes, collapsedIds), [notes, collapsedIds])
  const visibleItems = useMemo(
    () => view === "compact" ? treeItems : notes.map((note) => ({ note, depth: 0, hasChildren: false })),
    [notes, treeItems, view],
  )
  const visibleIds = useMemo(() => visibleItems.map((item) => item.note.id), [visibleItems])
  const noteIdSet = useMemo(() => new Set(notes.map((note) => note.id)), [notes])
  const visibleItemById = useMemo(() => new Map(visibleItems.map((item) => [item.note.id, item])), [visibleItems])
  const selectedNoteIdSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds])
  const collapsibleIds = useMemo(() => treeItems.filter((item) => item.hasChildren).map((item) => item.note.id), [treeItems])
  const allCollapsed = collapsibleIds.length > 0 && collapsibleIds.every((id) => collapsedIds.includes(id))

  useEffect(() => {
    const visibleIdSet = new Set(visibleIds)
    setSelectedNoteIds((prev) => {
      const next = prev.filter((id) => visibleIdSet.has(id))
      return next.length === prev.length ? prev : next
    })
    setSelectionAnchorId((current) => {
      if (current && visibleIdSet.has(current)) return current
      if (selectedId && visibleIdSet.has(selectedId)) return selectedId
      return null
    })
  }, [selectedId, visibleIds])

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => prev.includes(id)
      ? prev.filter((item) => item !== id)
      : [...prev, id])
  }

  const toggleAllCollapsed = () => {
    setCollapsedIds(allCollapsed ? [] : collapsibleIds)
  }

  const locateSelectedNote = () => {
    document.querySelector("[data-active-note='true']")?.scrollIntoView({ block: "nearest" })
  }

  const handleSelectNote = (id: string, event: NoteSelectionInput) => {
    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = visibleIds.indexOf(selectionAnchorId)
      const targetIndex = visibleIds.indexOf(id)
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        setSelectedNoteIds(visibleIds.slice(start, end + 1))
      } else {
        setSelectedNoteIds([id])
        setSelectionAnchorId(id)
      }
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedNoteIds((prev) => (
        prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      ))
      setSelectionAnchorId(id)
    } else {
      setSelectedNoteIds([id])
      setSelectionAnchorId(id)
    }

    onSelect(id)
  }

  const clearSelection = () => {
    setSelectedNoteIds([])
    setSelectionAnchorId(selectedId)
  }

  const deleteSelectedNotes = async (ids = selectedNoteIds) => {
    const uniqueIds = Array.from(new Set(ids))
    if (!uniqueIds.length || deletingSelected) return
    setDeletingSelected(true)
    try {
      await onDeleteNotes(uniqueIds)
      const deletedIdSet = new Set(uniqueIds)
      setSelectedNoteIds((prev) => prev.filter((id) => !deletedIdSet.has(id)))
      setSelectionAnchorId((current) => current && deletedIdSet.has(current) ? null : current)
    } finally {
      setDeletingSelected(false)
    }
  }

  const clearNoteDrag = () => {
    draggingNoteIdRef.current = null
    setDraggingNoteId(null)
    setDragOverNote(null)
  }

  const canDropNote = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return false
    const source = visibleItemById.get(sourceId)?.note
    const target = visibleItemById.get(targetId)?.note
    if (!source || !target) return false
    return noteParentKey(source, noteIdSet) === noteParentKey(target, noteIdSet)
  }

  const handleNoteDragStart = (id: string) => (event: DragEvent<HTMLElement>) => {
    if (!onReorderNotes) {
      event.preventDefault()
      return
    }
    if (event.target instanceof Element && event.target.closest("button, input, textarea, a, [role='menu']")) {
      event.preventDefault()
      return
    }
    draggingNoteIdRef.current = id
    setDraggingNoteId(id)
    setDragOverNote(null)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", id)
  }

  const handleNoteDragOver = (id: string) => (event: DragEvent<HTMLElement>) => {
    const sourceId = draggingNoteIdRef.current
    if (!sourceId || !canDropNote(sourceId, id)) {
      if (dragOverNote) setDragOverNote(null)
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    const rect = event.currentTarget.getBoundingClientRect()
    const position: DragOverPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after"
    setDragOverNote((current) => (
      current?.id === id && current.position === position ? current : { id, position }
    ))
  }

  const handleNoteDrop = (targetId: string) => (event: DragEvent<HTMLElement>) => {
    const sourceId = draggingNoteIdRef.current
    const position = dragOverNote?.id === targetId ? dragOverNote.position : "after"
    clearNoteDrag()
    if (!sourceId || !onReorderNotes || !canDropNote(sourceId, targetId)) return

    event.preventDefault()
    event.stopPropagation()
    const target = visibleItemById.get(targetId)?.note
    if (!target) return

    const parentKey = noteParentKey(target, noteIdSet)
    const siblingIds = notes
      .filter((note) => noteParentKey(note, noteIdSet) === parentKey)
      .map((note) => note.id)
    const nextSiblingIds = moveNoteId(siblingIds, sourceId, targetId, position)
    if (!nextSiblingIds || arraysEqual(nextSiblingIds, siblingIds)) return
    void onReorderNotes(nextSiblingIds)
  }

  return (
    <section className="app-drag-region flex h-full min-w-0 shrink-0 flex-col border-r border-border bg-background">
      {/* 头部 */}
      <div className={cn("app-drag-region flex h-14 items-center gap-2 px-4", reserveWindowControls && "desktop-window-control-spacer")}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="min-w-0 truncate text-sm font-medium text-foreground">{notebookName}</h2>
            <span className="shrink-0 text-xs text-muted-foreground">{noteCount}篇</span>
          </div>
        </div>
        <div className="app-no-drag relative shrink-0" ref={viewMenuRef}>
          <button
            type="button"
            onClick={() => setViewMenuOpen((open) => !open)}
            aria-label="切换显示方式"
            aria-expanded={viewMenuOpen}
            className="flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card"
          >
            {view === "compact" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
            <span>{view === "compact" ? "目录" : "卡片"}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", viewMenuOpen && "rotate-180")} />
          </button>
          {viewMenuOpen && (
            <div className="absolute right-0 top-9 z-30 w-28 rounded-[6px] bg-popover p-1 text-sm text-popover-foreground shadow-lg shadow-black/15">
              <ViewMenuItem active={view === "compact"} icon={<List className="h-4 w-4" />} label="目录" onClick={() => changeView("compact")} />
              <ViewMenuItem active={view === "card"} icon={<LayoutGrid className="h-4 w-4" />} label="卡片" onClick={() => changeView("card")} />
            </div>
          )}
        </div>
      </div>

      <div className="mx-4 mb-3 border-t border-border/70" />

      <div className="app-no-drag flex items-center gap-2 px-4 pb-3">
        <div className="flex flex-1 items-center gap-2 rounded-[8px] border border-[#edf0f2] bg-[#f7f8fa] px-2.5 py-1.5 transition-colors focus-within:border-[#d9dee5] focus-within:bg-background dark:border-border dark:bg-card dark:focus-within:bg-card">
          <Search className="h-3.5 w-3.5 shrink-0 text-[#b7bec8] dark:text-muted-foreground/50" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onSearchChange("")
            }}
            placeholder="搜索笔记..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-[#b7bec8] focus:outline-none dark:placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button type="button" onClick={() => onSearchChange("")} aria-label="清除搜索" className="flex shrink-0 items-center justify-center rounded text-[#b7bec8] transition-colors hover:text-foreground dark:text-muted-foreground/50">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <CreateNoteMenu onCreateDocument={() => onCreateNote()} />
      </div>

      <div className="app-no-drag px-3 pb-1">
        <button
          type="button"
          onClick={onHomeSelect}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-sm transition-colors",
            homeActive ? "bg-card text-foreground" : "text-foreground/90 hover:bg-card/60",
          )}
        >
          <Home className="h-4 w-4 shrink-0" />
          首页
        </button>
      </div>

      <div className="app-no-drag flex items-center justify-between gap-2 px-3 pb-1">
        <button
          type="button"
          onClick={onDirectorySelect}
          className={cn(
            "flex h-8 shrink-0 items-center gap-2 rounded-[6px] px-2.5 text-left text-sm transition-colors",
            directoryActive ? "text-foreground" : "text-foreground/90",
            "hover:bg-card/60",
          )}
        >
          {view === "compact" ? <List className="h-4 w-4 shrink-0" /> : <LayoutGrid className="h-4 w-4 shrink-0" />}
          <span>{view === "compact" ? "目录" : "卡片"}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={locateSelectedNote}
            disabled={!selectedId}
            aria-label="定位当前笔记"
            title="定位当前笔记"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <LocateFixed className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleAllCollapsed}
            disabled={!collapsibleIds.length}
            aria-label={allCollapsed ? "全部展开" : "全部收起"}
            title={allCollapsed ? "全部展开" : "全部收起"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {selectedNoteIds.length > 1 && (
        <div className="app-no-drag px-3 pb-2">
          <div className="flex h-9 items-center gap-2 rounded-[6px] bg-destructive/10 px-2.5 text-destructive">
            <span className="min-w-0 flex-1 truncate text-xs font-medium">已选择 {selectedNoteIds.length} 篇</span>
            <button
              type="button"
              onClick={() => void deleteSelectedNotes()}
              disabled={deletingSelected}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-xs font-medium transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="清除选择"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] transition-colors hover:bg-destructive/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pt-0">
        {notes.length === 0 && (
          <div className="app-no-drag flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "没有找到匹配的笔记" : "暂无笔记"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {searchQuery ? "试试其他关键词" : "点击「新建」创建你的第一篇笔记"}
            </p>
          </div>
        )}
        <ul className="app-no-drag flex flex-col gap-0.5 pb-3">
          {visibleItems.map(({ note, depth, hasChildren }) => (
            view === "compact" ? (
              <CompactNoteRow
                key={note.id}
                note={note}
                depth={depth}
                hasChildren={hasChildren}
                collapsed={collapsedIds.includes(note.id)}
                active={note.id === selectedId}
                selected={selectedNoteIdSet.has(note.id)}
                draggable={Boolean(onReorderNotes)}
                dragging={draggingNoteId === note.id}
                dragOverPosition={dragOverNote?.id === note.id ? dragOverNote.position : null}
                onClick={(event) => handleSelectNote(note.id, event)}
                onDragStart={handleNoteDragStart(note.id)}
                onDragOver={handleNoteDragOver(note.id)}
                onDrop={handleNoteDrop(note.id)}
                onDragEnd={clearNoteDrag}
                onToggleCollapsed={() => toggleCollapsed(note.id)}
                onCreateNote={() => onCreateNote(note.id)}
                onDelete={() => {
                  if (selectedNoteIds.length > 1 && selectedNoteIdSet.has(note.id)) {
                    void deleteSelectedNotes()
                    return
                  }
                  onDeleteNote(note.id)
                }}
                deleteLabel={selectedNoteIds.length > 1 && selectedNoteIdSet.has(note.id) ? "删除所选" : "删除"}
                onRename={() => setRenamingNote(note)}
              />
            ) : (
              <NoteCard
              key={note.id}
              note={note}
              active={note.id === selectedId}
              selected={selectedNoteIdSet.has(note.id)}
              draggable={Boolean(onReorderNotes)}
              dragging={draggingNoteId === note.id}
              dragOverPosition={dragOverNote?.id === note.id ? dragOverNote.position : null}
              onClick={(event) => handleSelectNote(note.id, event)}
              onDragStart={handleNoteDragStart(note.id)}
              onDragOver={handleNoteDragOver(note.id)}
              onDrop={handleNoteDrop(note.id)}
              onDragEnd={clearNoteDrag}
              onDelete={() => {
                if (selectedNoteIds.length > 1 && selectedNoteIdSet.has(note.id)) {
                  void deleteSelectedNotes()
                  return
                }
                onDeleteNote(note.id)
              }}
              deleteLabel={selectedNoteIds.length > 1 && selectedNoteIdSet.has(note.id) ? "删除所选" : "删除"}
              onRename={() => setRenamingNote(note)}
              onStar={() => onStarNote(note.id, !note.starred)}
              />
            )
          ))}
        </ul>
        {hasMore && (
          <div className="app-no-drag px-1 pb-4 pt-1">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="flex h-9 w-full items-center justify-center rounded-lg border border-border text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? "加载中..." : "加载更多"}
            </button>
          </div>
        )}
      </div>

      <PromptDialog
        open={Boolean(renamingNote)}
        onClose={() => setRenamingNote(null)}
        onSubmit={async (title) => {
          if (!renamingNote) return
          await onRenameNote(renamingNote.id, title)
        }}
        title="重命名笔记"
        placeholder="输入笔记名称"
        defaultValue={renamingNote?.title ?? ""}
        submitText="保存"
      />

    </section>
  )
}

function CreateNoteMenu({ onCreateDocument }: { onCreateDocument: () => void }) {
  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        aria-label="新建"
        title="新建"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-4 w-4" />
      </button>
      <div className="pointer-events-none absolute right-0 top-7 z-40 w-36 origin-top-right pt-2 opacity-0 translate-y-1 scale-[0.98] transition-all duration-150 ease-out group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100">
        <div className="rounded-[8px] border border-border/80 bg-popover p-1.5 text-sm text-popover-foreground shadow-lg shadow-black/15">
          <button
            type="button"
            onClick={onCreateDocument}
            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left transition-colors hover:bg-accent hover:text-foreground"
          >
            <FileText className="h-4 w-4 shrink-0 text-[#3b82f6]" />
            <span className="min-w-0 flex-1 truncate">文档</span>
          </button>
          <div className="my-1 border-t border-border/60" />
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left transition-colors hover:bg-accent hover:text-foreground"
          >
            <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">导入...</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ViewMenuItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  )
}

function flattenNoteTree(notes: Note[], collapsedIds: string[]): NoteTreeItem[] {
  const byParent = new Map<string, Note[]>()
  const noteIds = new Set(notes.map((note) => note.id))
  for (const note of notes) {
    const parentKey = note.parentId && noteIds.has(note.parentId) ? note.parentId : "__root__"
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), note])
  }

  const collapsed = new Set(collapsedIds)
  const result: NoteTreeItem[] = []
  const visited = new Set<string>()

  const walk = (parentKey: string, depth: number) => {
    for (const note of byParent.get(parentKey) ?? []) {
      if (visited.has(note.id)) continue
      visited.add(note.id)
      const children = byParent.get(note.id) ?? []
      result.push({ note, depth, hasChildren: children.length > 0 })
      if (children.length && !collapsed.has(note.id)) walk(note.id, depth + 1)
    }
  }

  walk("__root__", 0)
  return result
}

function noteParentKey(note: Note, noteIds: Set<string>): string {
  return note.parentId && noteIds.has(note.parentId) ? note.parentId : "__root__"
}

function moveNoteId(ids: string[], sourceId: string, targetId: string, position: DragOverPosition): string[] | null {
  if (sourceId === targetId) return null
  const withoutSource = ids.filter((id) => id !== sourceId)
  const targetIndex = withoutSource.indexOf(targetId)
  if (targetIndex === -1 || withoutSource.length === ids.length) return null
  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex
  withoutSource.splice(insertIndex, 0, sourceId)
  return withoutSource
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function NoteDropIndicator({ position }: { position: DragOverPosition | null }) {
  if (!position) return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-2 right-2 z-10 h-px rounded-full bg-primary/70",
        position === "before" ? "top-0" : "bottom-0",
      )}
    />
  )
}

function CompactNoteRow({ note, depth, hasChildren, collapsed, active, selected, draggable, dragging, dragOverPosition, onClick, onDragStart, onDragOver, onDrop, onDragEnd, onToggleCollapsed, onCreateNote, onDelete, deleteLabel, onRename }: {
  note: Note
  depth: number
  hasChildren: boolean
  collapsed: boolean
  active: boolean
  selected: boolean
  draggable: boolean
  dragging: boolean
  dragOverPosition: DragOverPosition | null
  onClick: (event: NoteSelectionInput) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onToggleCollapsed: () => void
  onCreateNote: () => void
  onDelete: () => void
  deleteLabel: string
  onRename: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [menuOpen])

  const handleCopyTitle = async () => {
    try {
      await navigator.clipboard.writeText(note.title)
    } catch {
      // Clipboard writes can fail in restricted browser contexts; no state change is required.
    }
    setMenuOpen(false)
  }

  return (
    <li className="relative">
      <NoteDropIndicator position={dragOverPosition} />
      <div
        role="button"
        tabIndex={0}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={(e) => onClick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })
          }
        }}
        className={cn(
          "group flex h-9 w-full cursor-pointer items-center gap-1 rounded-[6px] px-2.5 text-left transition-colors focus:outline-none",
          active ? "bg-card text-foreground" : "text-foreground/90 hover:bg-card/60 hover:text-foreground",
          draggable && "cursor-grab active:cursor-grabbing",
          dragging && "opacity-45",
        )}
        style={{ paddingLeft: `${10 + depth * 22}px` }}
        data-active-note={active ? "true" : undefined}
        data-selected-note={selected ? "true" : undefined}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) onToggleCollapsed()
          }}
          disabled={!hasChildren}
          aria-label={collapsed ? "展开子笔记" : "收起子笔记"}
          aria-expanded={!collapsed}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          {hasChildren ? (
            collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
          ) : null}
        </button>
        <span className={cn("min-w-0 flex-1 truncate text-sm", active && "font-medium")}>
          {note.title}
        </span>
        <div className="relative flex shrink-0 items-center gap-0" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((open) => !open)
            }}
            aria-label="更多操作"
            aria-expanded={menuOpen}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-[6px] transition-opacity hover:bg-accent",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCreateNote()
            }}
            aria-label="新建笔记"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-[6px] transition-opacity hover:bg-accent hover:text-foreground",
              "opacity-0 group-hover:opacity-100",
            )}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {menuOpen && (
            <NoteMenu
              onCopyTitle={handleCopyTitle}
              onRename={() => {
                setMenuOpen(false)
                onRename()
              }}
              onDelete={() => {
                setMenuOpen(false)
                onDelete()
              }}
              deleteLabel={deleteLabel}
            />
          )}
        </div>
      </div>
    </li>
  )
}

function NoteCard({ note, active, selected, draggable, dragging, dragOverPosition, onClick, onDragStart, onDragOver, onDrop, onDragEnd, onDelete, deleteLabel, onRename, onStar }: {
  note: Note
  active: boolean
  selected: boolean
  draggable: boolean
  dragging: boolean
  dragOverPosition: DragOverPosition | null
  onClick: (event: NoteSelectionInput) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDelete: () => void
  deleteLabel: string
  onRename: () => void
  onStar: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [menuOpen])

  const handleCopyTitle = async () => {
    try {
      await navigator.clipboard.writeText(note.title)
    } catch {
      // Clipboard writes can fail in restricted browser contexts; no state change is required.
    }
    setMenuOpen(false)
  }

  return (
    <li className="relative">
      <NoteDropIndicator position={dragOverPosition} />
      <div
        role="button"
        tabIndex={0}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={(e) => onClick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })
          }
        }}
        className={cn(
          "group flex min-h-[72px] w-full cursor-pointer flex-col gap-1 rounded-[6px] px-3 py-2.5 text-left transition-colors focus:outline-none",
          active
            ? "bg-card"
            : "hover:bg-card/60",
          draggable && "cursor-grab active:cursor-grabbing",
          dragging && "opacity-45",
        )}
        data-selected-note={selected ? "true" : undefined}
      >
        <div className="flex items-start justify-between gap-1.5">
          <h3 className="line-clamp-1 text-sm font-medium text-foreground">{note.title}</h3>
          <div className="relative flex shrink-0 items-center gap-0.5" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStar() }}
              aria-label={note.starred ? "取消收藏" : "收藏"}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-[6px] transition-opacity hover:bg-accent",
                note.starred ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <Star className={cn("h-3.5 w-3.5", note.starred ? "fill-primary text-primary" : "text-muted-foreground")} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((open) => !open)
              }}
              aria-label="更多操作"
              aria-expanded={menuOpen}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-[6px] transition-opacity hover:bg-accent",
                menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {menuOpen && (
              <NoteMenu
                onCopyTitle={handleCopyTitle}
                onRename={() => {
                  setMenuOpen(false)
                  onRename()
                }}
                onDelete={() => {
                  setMenuOpen(false)
                  onDelete()
                }}
                deleteLabel={deleteLabel}
              />
            )}
          </div>
        </div>
        <p className="line-clamp-1 text-xs leading-5 text-muted-foreground">{note.excerpt}</p>
        <div className="mt-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded bg-accent px-1.5 py-0.5">{note.notebook}</span>
          <span>·</span>
          <span className="font-mono">{note.date}</span>
        </div>
      </div>
    </li>
  )
}

function NoteMenu({ onCopyTitle, onRename, onDelete, deleteLabel = "删除" }: { onCopyTitle: () => void; onRename: () => void; onDelete: () => void; deleteLabel?: string }) {
  return (
    <div
      role="menu"
      className="absolute right-0 top-7 z-20 min-w-32 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-lg shadow-black/15"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onCopyTitle}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Copy className="h-3.5 w-3.5" />
        复制标题
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onRename}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
        重命名
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-destructive transition-colors hover:bg-destructive/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {deleteLabel}
      </button>
    </div>
  )
}

