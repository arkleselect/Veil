"use client"

import {
  Bold,
  Italic,
  Underline,
  ListOrdered,
  List,
  ListChecks,
  AlignLeft,
  Quote,
  Link2,
  ImageIcon,
  Table,
  Undo2,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  PanelLeft,
  PanelRight,
  Columns3,
  Columns2,
  BookOpen,
  CalendarDays,
  Tag,
  Star,
  Check,
  X,
  RemoveFormatting,
  Upload,
  Loader2,
  Paperclip,
  Pencil,
  Eye,
  GripVertical,
  Share2,
  Globe2,
  UserPlus,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Scissors,
  Trash2,
  Type,
  Highlighter,
  ListCollapse,
} from "lucide-react"
import type { HeadingLevel, Note, NoteBlock } from "@/lib/notes-data"
import type { Asset } from "@/lib/assets-data"
import { createPublicNoteShareLink, uploadAsset } from "@/lib/api"
import { copyText } from "@/lib/share"
import { cn } from "@/lib/utils"
import { useRef, useState, useCallback, useEffect } from "react"
import { Dialog, PromptDialog } from "@/components/dialog"
import { useToast } from "@/components/toast-provider"

interface EditorProps {
  note: Note | null
  sidebarOpen: boolean
  noteListOpen: boolean
  onToggleSidebar: () => void
  onToggleNoteList: () => void
  onUpdateNote: (id: string, data: Partial<Note>) => Promise<unknown>
}

interface BlockHistorySnapshot {
  blocks: NoteBlock[]
  keys: string[]
}

interface BlockSaveState {
  timer: ReturnType<typeof setTimeout> | null
  pendingBlocks: NoteBlock[] | null
  saving: boolean
  undoStack: BlockHistorySnapshot[]
  redoStack: BlockHistorySnapshot[]
}

interface TocHeading {
  text: string
  index: number
  level: HeadingLevel
  hasChildren: boolean
}

interface ImageBlockData {
  src: string
  alt: string
}

type ListBlockType = Extract<NoteBlock["type"], "bullet" | "ordered" | "todo">

const EDITOR_ARTICLE_WIDTH = "clamp(42rem, 72%, 54rem)"
const EDITOR_ARTICLE_MAX_WIDTH = "calc(100% - 3rem)"
const TOC_DEFAULT_WIDTH = 336
const TOC_MIN_WIDTH = 240
const TOC_MAX_WIDTH = 460
const LIST_INDENT_STEP_PX = 24
const MAX_LIST_INDENT = 6

export function Editor({ note, sidebarOpen, noteListOpen, onToggleSidebar, onToggleNoteList, onUpdateNote }: EditorProps) {
  const { toast } = useToast()
  const [tocOpen, setTocOpen] = useState(true)
  const [tocWidth, setTocWidth] = useState(TOC_DEFAULT_WIDTH)
  const [activeTocHeadingIndex, setActiveTocHeadingIndex] = useState<number | null>(null)
  const [collapsedTocHeadingIds, setCollapsedTocHeadingIds] = useState<Set<number>>(new Set())
  const [editingMode, setEditingMode] = useState(true)
  const [readingProgress, setReadingProgress] = useState(0)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [blocks, setBlocks] = useState<NoteBlock[]>([])
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [shareMenuOpen, setShareMenuOpen] = useState(false)
  const [publicSharePending, setPublicSharePending] = useState(false)
  const [imageUrlDraft, setImageUrlDraft] = useState("")
  const [imageUploadPending, setImageUploadPending] = useState(false)
  const [imageDialogError, setImageDialogError] = useState("")
  const [attachmentUploadPending, setAttachmentUploadPending] = useState(false)
  const [inlineFormats, setInlineFormats] = useState({ bold: false, italic: false, underline: false })
  const [activeBlockIndex, setActiveBlockIndex] = useState<number | null>(null)
  const [selectedBlockIndexes, setSelectedBlockIndexes] = useState<Set<number>>(new Set())
  const [handleHoverIndex, setHandleHoverIndex] = useState<number | null>(null)
  const [blockMenuIndex, setBlockMenuIndex] = useState<number | null>(null)
  const [blockTransformMenuOpen, setBlockTransformMenuOpen] = useState(false)
  const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null)
  const [blockSelectionDragging, setBlockSelectionDragging] = useState(false)
  const [blockSelectionBox, setBlockSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const activeBlockRef = useRef<number | null>(null)
  const lastSelectedBlockIndexRef = useRef<number | null>(null)
  const blockKeyCounterRef = useRef(0)
  const [blockKeys, setBlockKeys] = useState<string[]>([])
  const blockKeysRef = useRef<string[]>([])
  const draggedBlockIndexRef = useRef<number | null>(null)
  const dragInsertIndexRef = useRef<number | null>(null)
  const editorBlocksRef = useRef<HTMLDivElement | null>(null)
  const lastSelectAllRef = useRef<{ index: number; at: number } | null>(null)
  const savedSelectionRef = useRef<Range | null>(null)
  const textEditHistoryRef = useRef<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const onUpdateNoteRef = useRef(onUpdateNote)
  const blockSaveStateRef = useRef<Map<string, BlockSaveState>>(new Map())
  const flushBlockSaveRef = useRef<(noteId: string) => void>(() => {})
  const blocksRef = useRef<NoteBlock[]>([])
  const blockRefs = useRef<(HTMLDivElement | null)[]>([])
  const appliedNoteRef = useRef<{ id: string; version: number } | null>(null)
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null)
  const blockMenuRef = useRef<HTMLDivElement | null>(null)
  const shareMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    onUpdateNoteRef.current = onUpdateNote
  }, [onUpdateNote])

  useEffect(() => {
    if (blockMenuIndex === null) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && blockMenuRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-block-menu-trigger="true"]')) return
      setBlockMenuIndex(null)
      setBlockTransformMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setBlockMenuIndex(null)
      setBlockTransformMenuOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [blockMenuIndex])

  useEffect(() => {
    if (!shareMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && shareMenuRef.current?.contains(target)) return
      setShareMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShareMenuOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [shareMenuOpen])

  const makeBlockKey = useCallback(() => {
    blockKeyCounterRef.current += 1
    return `block-${blockKeyCounterRef.current}`
  }, [])

  const applyBlockKeys = useCallback((keys: string[]) => {
    blockKeysRef.current = keys
    setBlockKeys(keys)
  }, [])

  useEffect(() => {
    const saveStates = blockSaveStateRef.current
    flushBlockSaveRef.current = (noteId: string) => {
      const run = async () => {
        const state = saveStates.get(noteId)
        if (!state || state.saving || !state.pendingBlocks) return

        const blocksToSave = state.pendingBlocks
        state.pendingBlocks = null
        state.saving = true

        try {
          await onUpdateNoteRef.current(noteId, { blocks: blocksToSave })
        } catch {
          // Workspace owns the concrete failure and conflict messaging.
        } finally {
          const latest = saveStates.get(noteId)
          if (!latest) return
          latest.saving = false

          if (latest.pendingBlocks && !latest.timer) {
            flushBlockSaveRef.current(noteId)
          }
        }
      }

      void run()
    }

    return () => {
      for (const state of saveStates.values()) {
        if (state.timer) clearTimeout(state.timer)
      }
      saveStates.clear()
    }
  }, [])

  const cloneBlocks = useCallback((value: NoteBlock[]) => value.map((block) => ({ ...block })), [])

  const ensureSaveState = useCallback((noteId: string) => {
    let state = blockSaveStateRef.current.get(noteId)
    if (!state) {
      state = { timer: null, pendingBlocks: null, saving: false, undoStack: [], redoStack: [] }
      blockSaveStateRef.current.set(noteId, state)
    }
    return state
  }, [])

  const saveBlocks = useCallback((noteId: string, newBlocks: NoteBlock[]) => {
    let state = blockSaveStateRef.current.get(noteId)
    if (!state) {
      state = { timer: null, pendingBlocks: null, saving: false, undoStack: [], redoStack: [] }
      blockSaveStateRef.current.set(noteId, state)
    }

    state.pendingBlocks = newBlocks.map((block) => ({ ...block }))
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      const latest = blockSaveStateRef.current.get(noteId)
      if (!latest) return
      latest.timer = null
      flushBlockSaveRef.current(noteId)
    }, 600)
  }, [])

  const createHistorySnapshot = useCallback((snapshot: NoteBlock[] = blocksRef.current): BlockHistorySnapshot => {
    const blocksSnapshot = cloneBlocks(snapshot)
    const keys = blockKeysRef.current.length === blocksSnapshot.length
      ? [...blockKeysRef.current]
      : blocksSnapshot.map(() => makeBlockKey())
    return { blocks: blocksSnapshot, keys }
  }, [cloneBlocks, makeBlockKey])

  const pushUndoSnapshot = useCallback((noteId: string, snapshot: NoteBlock[] = blocksRef.current) => {
    const state = ensureSaveState(noteId)
    state.undoStack.push(createHistorySnapshot(snapshot))
    if (state.undoStack.length > 50) state.undoStack.shift()
    state.redoStack = []
  }, [createHistorySnapshot, ensureSaveState])

  const commitBlocks = useCallback((noteId: string, nextBlocks: NoteBlock[], options: { recordHistory?: boolean } = {}) => {
    if (options.recordHistory !== false) pushUndoSnapshot(noteId, blocksRef.current)
    const cloned = cloneBlocks(nextBlocks)
    blocksRef.current = cloned
    setBlocks(cloned)
    saveBlocks(noteId, cloned)
  }, [cloneBlocks, pushUndoSnapshot, saveBlocks])

  const replaceBlocksWithoutHistory = useCallback((noteId: string, nextBlocks: NoteBlock[], nextKeys?: string[]) => {
    const cloned = cloneBlocks(nextBlocks)
    blocksRef.current = cloned
    setBlocks(cloned)
    applyBlockKeys(nextKeys && nextKeys.length === cloned.length ? [...nextKeys] : cloned.map(() => makeBlockKey()))
    saveBlocks(noteId, cloned)
    const renderDom = () => {
      cloned.forEach((block, index) => {
        const el = blockRefs.current[index]
        if (el && el.innerHTML !== block.text) el.innerHTML = block.text
      })
    }
    renderDom()
    window.requestAnimationFrame(renderDom)
  }, [applyBlockKeys, cloneBlocks, makeBlockKey, saveBlocks])

  const clearBlockSelection = useCallback(() => {
    setSelectedBlockIndexes(new Set())
    lastSelectedBlockIndexRef.current = null
  }, [])

  const focusBlock = useCallback((index: number, placement: "start" | "end" = "end") => {
    const el = blockRefs.current[index]
    if (!el) return
    el.focus()
    activeBlockRef.current = index
    setActiveBlockIndex(index)

    if (getImageBlockData(blocksRef.current[index]?.text ?? "")) {
      window.getSelection()?.removeAllRanges()
      return
    }

    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(placement === "start")
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [])

  const readBlocksFromDom = useCallback((source: NoteBlock[] = blocksRef.current) => {
    return source.map((b, i) => {
      if (getImageBlockData(b.text)) return b
      const el = blockRefs.current[i]
      return el ? { ...b, text: el.innerHTML } : b
    })
  }, [])

  useEffect(() => {
    const isEditorFocused = blockRefs.current.some((el) => el && document.activeElement === el)
    const applied = appliedNoteRef.current
    const noteVersion = note?.version ?? 0
    const switchedNote = applied?.id !== note?.id
    const changedVersion = applied?.version !== noteVersion
    if (!switchedNote && (!changedVersion || isEditorFocused)) return

    if (note) {
      const nextBlocks = note.blocks.map((b) => ({ ...b }))
      blocksRef.current = nextBlocks
      setBlocks(nextBlocks)
      applyBlockKeys(nextBlocks.map(() => makeBlockKey()))
      setSelectedBlockIndexes(new Set())
      lastSelectedBlockIndexRef.current = null
      activeBlockRef.current = null
      setActiveBlockIndex(null)
      appliedNoteRef.current = { id: note.id, version: note.version }
      ensureSaveState(note.id)
    } else {
      blocksRef.current = []
      setBlocks([])
      applyBlockKeys([])
      setSelectedBlockIndexes(new Set())
      lastSelectedBlockIndexRef.current = null
      activeBlockRef.current = null
      setActiveBlockIndex(null)
      appliedNoteRef.current = null
    }
  }, [applyBlockKeys, ensureSaveState, makeBlockKey, note])

  useEffect(() => {
    if (!note) return
    const update = () => {
      setInlineFormats({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
      })
    }
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [note])

  const activeType = activeBlockIndex !== null && activeBlockIndex < blocks.length ? blocks[activeBlockIndex].type : undefined

  const captureSelection = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const activeIndex = activeBlockRef.current
    const activeBlock = activeIndex === null ? null : blockRefs.current[activeIndex]
    if (!activeBlock || !activeBlock.contains(range.commonAncestorContainer)) return
    savedSelectionRef.current = range.cloneRange()
  }, [])

  const restoreSelection = useCallback(() => {
    const range = savedSelectionRef.current
    const selection = window.getSelection()
    if (!range || !selection) return
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  const domSave = useCallback(() => {
    if (!note) return
    const updated = readBlocksFromDom()
    blocksRef.current = updated
    saveBlocks(note.id, updated)
  }, [note, readBlocksFromDom, saveBlocks])

  const undoBlocks = useCallback(() => {
    if (!note) return
    const state = blockSaveStateRef.current.get(note.id)
    const previous = state?.undoStack.pop()
    if (!state || !previous) return
    state.redoStack.push(createHistorySnapshot())
    replaceBlocksWithoutHistory(note.id, previous.blocks, previous.keys)
    textEditHistoryRef.current = null
    clearBlockSelection()
    activeBlockRef.current = null
    setActiveBlockIndex(null)
  }, [clearBlockSelection, createHistorySnapshot, note, replaceBlocksWithoutHistory])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!note || !editingMode) return
      if (event.defaultPrevented || event.isComposing) return

      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return
      }

      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault()
        undoBlocks()
      }
    }

    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [editingMode, note, undoBlocks])

  const getListGroupIndexes = useCallback((index: number, source: NoteBlock[] = blocksRef.current) => {
    if (!isListBlock(source[index])) return [index]

    let start = index
    while (start > 0 && isListBlock(source[start - 1])) start -= 1

    let end = index + 1
    while (end < source.length && isListBlock(source[end])) end += 1

    return Array.from({ length: end - start }, (_, offset) => start + offset)
  }, [])

  const deleteBlockIndexes = useCallback((indexes: Set<number>) => {
    if (!note || indexes.size === 0) return
    const current = readBlocksFromDom()
    const normalized = new Set(
      Array.from(indexes).filter((index) => index >= 0 && index < current.length),
    )
    if (normalized.size === 0) return

    const currentKeys = blockKeys.length === current.length
      ? blockKeys
      : current.map(() => makeBlockKey())
    const nextBlocks = current.filter((_, index) => !normalized.has(index))
    const nextKeys = currentKeys.filter((_, index) => !normalized.has(index))

    if (nextBlocks.length === 0) {
      nextBlocks.push({ type: "paragraph", text: "" })
      nextKeys.push(makeBlockKey())
    }

    const focusIndex = Math.min(
      Math.max(0, Math.min(...Array.from(normalized))),
      nextBlocks.length - 1,
    )
    commitBlocks(note.id, nextBlocks)
    applyBlockKeys(nextKeys)
    clearBlockSelection()
    setTimeout(() => {
      focusBlock(focusIndex)
    }, 0)
  }, [applyBlockKeys, blockKeys, clearBlockSelection, commitBlocks, focusBlock, makeBlockKey, note, readBlocksFromDom])

  const getActionBlockIndexes = useCallback((index: number) => {
    const currentLength = blocksRef.current.length
    const current = blocksRef.current
    const indexes = selectedBlockIndexes.has(index)
      ? Array.from(selectedBlockIndexes)
      : isListBlock(current[index])
        ? getListGroupIndexes(index, current)
        : [index]
    return Array.from(new Set(indexes))
      .filter((item) => item >= 0 && item < currentLength)
      .sort((a, b) => a - b)
  }, [getListGroupIndexes, selectedBlockIndexes])

  const getBlocksClipboardData = useCallback((indexes: number[]) => {
    const current = readBlocksFromDom()
    const selectedIndexes = Array.from(new Set(indexes))
      .filter((index) => index >= 0 && index < current.length)
      .sort((a, b) => a - b)

    const selectedBlocks = selectedIndexes.map((index) => ({
      block: current[index],
      orderedNumber: getOrderedListNumber(current, index),
    }))

    return {
      plainText: selectedBlocks.map(({ block, orderedNumber }) => blockToClipboardText(block, orderedNumber)).join("\n\n"),
      html: selectedBlocks.map(({ block, orderedNumber }) => blockToClipboardHtml(block, orderedNumber)).join(""),
    }
  }, [readBlocksFromDom])

  const getSelectedBlocksClipboardData = useCallback(() => {
    return getBlocksClipboardData(Array.from(selectedBlockIndexes))
  }, [getBlocksClipboardData, selectedBlockIndexes])

  const writeBlocksToClipboard = useCallback(async (indexes: number[]) => {
    const { plainText, html } = getBlocksClipboardData(indexes)
    if (!plainText && !html) return false

    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const items: Record<string, Blob> = {
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }
        if (html) items["text/html"] = new Blob([html], { type: "text/html" })
        await navigator.clipboard.write([new ClipboardItem(items)])
      } else {
        await navigator.clipboard.writeText(plainText)
      }
      return true
    } catch {
      if (copyBlocksWithSelectionFallback(plainText, html)) return true
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(plainText)
          return true
        }
      } catch {
        // The user-facing failure is reported below after every fallback fails.
      }
      toast("复制失败", "error")
      return false
    }
  }, [getBlocksClipboardData, toast])

  const copyBlockIndexes = useCallback(async (indexes: number[]) => {
    if (await writeBlocksToClipboard(indexes)) toast("已复制", "success")
  }, [toast, writeBlocksToClipboard])

  const cutBlockIndexes = useCallback(async (indexes: number[]) => {
    if (!note || indexes.length === 0) return
    if (!(await writeBlocksToClipboard(indexes))) return
    deleteBlockIndexes(new Set(indexes))
    toast("已剪切", "success")
  }, [deleteBlockIndexes, note, toast, writeBlocksToClipboard])

  const transformBlockIndexes = useCallback((indexes: number[], type: NoteBlock["type"], level?: HeadingLevel) => {
    if (!note || indexes.length === 0) return
    const current = readBlocksFromDom()
    const normalizedIndexes = Array.from(new Set(indexes))
      .filter((index) => index >= 0 && index < current.length)
      .sort((a, b) => a - b)
    if (normalizedIndexes.length === 0) return
    if (type === "toggle") {
      const firstIndex = normalizedIndexes[0]
      const lastIndex = normalizedIndexes[normalizedIndexes.length - 1]
      const currentKeys = blockKeys.length === current.length
        ? [...blockKeys]
        : current.map(() => makeBlockKey())
      const toggleId = makeToggleId()
      const next = current.map((block, index) => (
        index >= firstIndex && index <= lastIndex
          ? { ...block, toggleParentId: toggleId }
          : block
      ))
      const nextKeys = [...currentKeys]
      next.splice(firstIndex, 0, { type: "toggle", text: "", collapsed: false, toggleId })
      nextKeys.splice(firstIndex, 0, makeBlockKey())
      commitBlocks(note.id, next)
      applyBlockKeys(nextKeys)
      clearBlockSelection()
      activeBlockRef.current = firstIndex
      setActiveBlockIndex(firstIndex)
      setBlockMenuIndex(null)
      setBlockTransformMenuOpen(false)
      setTimeout(() => {
        focusBlock(firstIndex)
      }, 0)
      return
    }
    const indexSet = new Set(normalizedIndexes)
    const next = current.map((block, index) => {
      if (!indexSet.has(index)) return block
      return toTypedBlock(block, type, block.text, { level })
    })
    commitBlocks(note.id, next)
    setSelectedBlockIndexes(new Set(normalizedIndexes))
    lastSelectedBlockIndexRef.current = normalizedIndexes[normalizedIndexes.length - 1] ?? null
    activeBlockRef.current = normalizedIndexes[0] ?? null
    setActiveBlockIndex(normalizedIndexes[0] ?? null)
    setBlockMenuIndex(null)
    setBlockTransformMenuOpen(false)
  }, [applyBlockKeys, blockKeys, clearBlockSelection, commitBlocks, focusBlock, makeBlockKey, note, readBlocksFromDom])

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      if (selectedBlockIndexes.size === 0) return
      const { plainText, html } = getSelectedBlocksClipboardData()
      if (!plainText && !html) return

      event.preventDefault()
      event.clipboardData?.setData("text/plain", plainText)
      event.clipboardData?.setData("text/html", html)
    }

    document.addEventListener("copy", handleCopy)
    return () => document.removeEventListener("copy", handleCopy)
  }, [getSelectedBlocksClipboardData, selectedBlockIndexes.size])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (selectedBlockIndexes.size === 0) return
      if (event.defaultPrevented || event.isComposing) return
      if (event.key !== "Backspace" && event.key !== "Delete") return

      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return
      }

      if (target instanceof HTMLElement && target.isContentEditable) {
        const belongsToSelectedBlock = blockRefs.current.some((blockEl, index) => (
          !!blockEl &&
          selectedBlockIndexes.has(index) &&
          blockEl.contains(target)
        ))
        if (!belongsToSelectedBlock) return
      }

      event.preventDefault()
      deleteBlockIndexes(selectedBlockIndexes)
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [deleteBlockIndexes, selectedBlockIndexes])

  const selectBlock = useCallback((index: number, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    activeBlockRef.current = index
    setActiveBlockIndex(index)
    window.getSelection()?.removeAllRanges()

    setSelectedBlockIndexes((prev) => {
      if (event.shiftKey && lastSelectedBlockIndexRef.current !== null) {
        const start = Math.min(lastSelectedBlockIndexRef.current, index)
        const end = Math.max(lastSelectedBlockIndexRef.current, index)
        return new Set(Array.from({ length: end - start + 1 }, (_, offset) => start + offset))
      }

      if (event.metaKey || event.ctrlKey) {
        const next = new Set(prev)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        lastSelectedBlockIndexRef.current = index
        return next
      }

      lastSelectedBlockIndexRef.current = index
      return new Set([index])
    })
  }, [])

  const getBlockRows = useCallback(() => {
    const container = editorBlocksRef.current
    if (!container) return []

    return Array.from(container.querySelectorAll<HTMLElement>("[data-editor-row-index]"))
      .map((row) => ({
        index: Number(row.dataset.editorRowIndex),
        rect: row.getBoundingClientRect(),
      }))
      .filter((row) => Number.isInteger(row.index))
  }, [])

  const startBlockBoxSelection = useCallback((index: number, startX: number, startY: number, currentX = startX, currentY = startY) => {
    setBlockSelectionDragging(true)
    activeBlockRef.current = index
    lastSelectedBlockIndexRef.current = index
    setActiveBlockIndex(index)
    setSelectedBlockIndexes(new Set([index]))
    window.getSelection()?.removeAllRanges()

    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = "none"

    const updateSelectionBox = (currentX: number, currentY: number) => {
      const container = editorBlocksRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const left = Math.min(startX, currentX) - containerRect.left
      const top = Math.min(startY, currentY) - containerRect.top
      const width = Math.max(1, Math.abs(currentX - startX))
      const height = Math.max(1, Math.abs(currentY - startY))
      const selectionLeft = Math.min(startX, currentX)
      const selectionRight = Math.max(startX, currentX)
      const selectionTop = Math.min(startY, currentY)
      const selectionBottom = Math.max(startY, currentY)
      const selectedRows = getBlockRows()
        .filter(({ rect }) => {
          const hitLeft = rect.left - 96
          const hitRight = rect.right
          return (
            hitRight >= selectionLeft &&
            hitLeft <= selectionRight &&
            rect.bottom >= selectionTop &&
            rect.top <= selectionBottom
          )
        })
        .map(({ index: rowIndex }) => rowIndex)
      const nextIndexes = selectedRows.length > 0 ? selectedRows : [index]
      const targetIndex = nextIndexes[nextIndexes.length - 1] ?? index

      setBlockSelectionBox({ left, top, width, height })
      setSelectedBlockIndexes(new Set(nextIndexes))
      activeBlockRef.current = targetIndex
      lastSelectedBlockIndexRef.current = targetIndex
      setActiveBlockIndex(targetIndex)
    }

    updateSelectionBox(currentX, currentY)

    const handleMouseMove = (mouseEvent: MouseEvent) => {
      updateSelectionBox(mouseEvent.clientX, mouseEvent.clientY)
    }

    const handleMouseUp = () => {
      document.body.style.userSelect = previousUserSelect
      setBlockSelectionDragging(false)
      setBlockSelectionBox(null)
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
  }, [getBlockRows])

  const startBlockRangeSelection = useCallback((index: number, event: React.MouseEvent) => {
    if (!editingMode || event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()
    startBlockBoxSelection(index, event.clientX, event.clientY)
  }, [editingMode, startBlockBoxSelection])

  const reorderBlock = useCallback((fromIndex: number, insertIndex: number) => {
    if (!note || fromIndex < 0 || fromIndex >= blocksRef.current.length) return
    const current = readBlocksFromDom()
    const currentKeys = blockKeys.length === current.length
      ? [...blockKeys]
      : current.map(() => makeBlockKey())
    const movingIndexes = (
      selectedBlockIndexes.has(fromIndex)
        ? Array.from(selectedBlockIndexes)
        : isListBlock(current[fromIndex])
          ? getListGroupIndexes(fromIndex, current)
          : [fromIndex]
    )
      .filter((index) => index >= 0 && index < current.length)
      .sort((a, b) => a - b)
    const movingIndexSet = new Set(movingIndexes)
    const movedBlocks = movingIndexes.map((index) => current[index])
    const movedKeys = movingIndexes.map((index) => currentKeys[index])
    const removedBeforeInsert = movingIndexes.filter((index) => index < insertIndex).length
    const remainingBlocks = current.filter((_, index) => !movingIndexSet.has(index))
    const remainingKeys = currentKeys.filter((_, index) => !movingIndexSet.has(index))
    const targetIndex = Math.max(0, Math.min(remainingBlocks.length, insertIndex - removedBeforeInsert))

    remainingBlocks.splice(targetIndex, 0, ...movedBlocks)
    remainingKeys.splice(targetIndex, 0, ...movedKeys)

    commitBlocks(note.id, remainingBlocks)
    applyBlockKeys(remainingKeys)
    setSelectedBlockIndexes(new Set(movedBlocks.map((_, offset) => targetIndex + offset)))
    lastSelectedBlockIndexRef.current = targetIndex
    activeBlockRef.current = targetIndex
    setActiveBlockIndex(targetIndex)
  }, [applyBlockKeys, blockKeys, commitBlocks, getListGroupIndexes, makeBlockKey, note, readBlocksFromDom, selectedBlockIndexes])

  const getDragInsertIndex = useCallback((clientY: number, container: HTMLElement) => {
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-editor-row-index]"))
      .map((row) => ({
        index: Number(row.dataset.editorRowIndex),
        rect: row.getBoundingClientRect(),
      }))
      .filter((row) => Number.isInteger(row.index))

    for (const row of rows) {
      if (clientY < row.rect.top + row.rect.height / 2) return row.index
    }

    return blocksRef.current.length
  }, [])

  const handleBlockInput = useCallback((index: number, e: React.FormEvent<HTMLDivElement>) => {
    if (!editingMode) return
    lastSelectAllRef.current = null
    const plainText = e.currentTarget.textContent ?? ""
    const codeShortcut = plainText === "```" || plainText === "```\u00a0" || plainText === "``` "
    if (codeShortcut) {
      e.currentTarget.innerHTML = ""
      if (!note) return
      const current = readBlocksFromDom()
      const next = current.map((block, i) => (i === index ? toTypedBlock(block, "code", "") : block))
      commitBlocks(note.id, next)
      return
    }

    const headingShortcut = plainText.match(/^(#{1,3})(?: |\u00a0)$/)
    if (headingShortcut) {
      e.currentTarget.innerHTML = ""
      const level = headingShortcut[1].length as HeadingLevel
      if (!note) return
      const current = readBlocksFromDom()
      const next = current.map((block, i) => (i === index ? toTypedBlock(block, "heading", "", { level }) : block))
      commitBlocks(note.id, next)
      return
    }

    const bulletShortcut = plainText.match(/^[-*+](?: |\u00a0)$/)
    if (bulletShortcut) {
      e.currentTarget.innerHTML = ""
      if (!note) return
      const current = readBlocksFromDom()
      const next = current.map((block, i) => (i === index ? toTypedBlock(block, "bullet", "") : block))
      commitBlocks(note.id, next)
      return
    }

    const orderedShortcut = plainText.match(/^\d+[.)](?: |\u00a0)$/)
    if (orderedShortcut) {
      e.currentTarget.innerHTML = ""
      if (!note) return
      const current = readBlocksFromDom()
      const next = current.map((block, i) => (i === index ? toTypedBlock(block, "ordered", "") : block))
      commitBlocks(note.id, next)
      return
    }

    const html = e.currentTarget.innerHTML
    if (note && textEditHistoryRef.current !== `${note.id}:${index}`) {
      pushUndoSnapshot(note.id, blocksRef.current)
      textEditHistoryRef.current = `${note.id}:${index}`
    }
    blocksRef.current = blocksRef.current.map((block, i) => (i === index ? { ...block, text: html } : block))
    domSave()
  }, [commitBlocks, domSave, editingMode, note, pushUndoSnapshot, readBlocksFromDom])

  const handleBlockBlur = useCallback(() => {
    if (!editingMode) return
    textEditHistoryRef.current = null
    const updated = readBlocksFromDom()
    blocksRef.current = updated
    setBlocks(updated)
  }, [editingMode, readBlocksFromDom])

  const handleBlockKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editingMode) return
    const el = e.currentTarget
    const key = e.key.toLowerCase()

    if ((e.metaKey || e.ctrlKey) && key === "a") {
      const now = Date.now()
      const previous = lastSelectAllRef.current
      if (previous?.index === index && now - previous.at < 1200) {
        e.preventDefault()
        const allIndexes = new Set(blocks.map((_, blockIndex) => blockIndex))
        setSelectedBlockIndexes(allIndexes)
        lastSelectedBlockIndexRef.current = blocks.length - 1
        activeBlockRef.current = index
        setActiveBlockIndex(index)
        window.getSelection()?.removeAllRanges()
        return
      }
      lastSelectAllRef.current = { index, at: now }
      return
    }

    if ((e.key === "Backspace" || e.key === "Delete") && selectedBlockIndexes.size > 0) {
      e.preventDefault()
      deleteBlockIndexes(selectedBlockIndexes)
      return
    }

    if (e.key === "Tab") {
      const current = readBlocksFromDom()
      const selectedIndexes = selectedBlockIndexes.has(index)
        ? Array.from(selectedBlockIndexes)
        : [index]
      const listIndexes = selectedIndexes
        .filter((blockIndex) => blockIndex >= 0 && blockIndex < current.length && isListBlock(current[blockIndex]))

      if (listIndexes.length > 0) {
        if (!note) return
        e.preventDefault()
        const direction = e.shiftKey ? -1 : 1
        const next = current.map((block, blockIndex) => {
          if (!listIndexes.includes(blockIndex) || !isListBlock(block)) return block
          return withListIndent(block, getBlockIndent(block) + direction)
        })
        commitBlocks(note.id, next)
        if (selectedBlockIndexes.has(index)) {
          setSelectedBlockIndexes(new Set(listIndexes))
          lastSelectedBlockIndexRef.current = listIndexes[listIndexes.length - 1] ?? null
        }
        return
      }
    }

    if (e.key === "Enter" && blocksRef.current[index]?.type === "code" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      document.execCommand("insertText", false, "\n")
      domSave()
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      if (!note) return
      e.preventDefault()
      const split = splitEditableBlockAtSelection(el)
      const current = readBlocksFromDom()
      const next = [...current]
      const nextKeys = blockKeys.length === current.length
        ? [...blockKeys]
        : current.map(() => makeBlockKey())
      let focusIndex = index + 1
      const block = current[index]
      const parentId = block.toggleParentId

      if (block.type === "toggle") {
        next[index] = block.toggleId
          ? toToggleBlock({ ...block, text: split.beforeHtml }, block.toggleId)
          : { ...block, text: split.beforeHtml }
        next.splice(index + 1, 0, {
          type: "paragraph",
          text: split.afterHtml,
          ...(block.toggleId ? { toggleParentId: block.toggleId } : {}),
        })
      } else if (isListBlock(block) && isEmptyHtml(split.beforeHtml) && isEmptyHtml(split.afterHtml)) {
        next[index] = { type: "paragraph", text: "", ...(parentId ? { toggleParentId: parentId } : {}) }
        focusIndex = index
      } else if (split.atStart) {
        next[index] = isListBlock(block)
          ? listContinuationBlock(block, "")
          : { type: "paragraph", text: "", ...(parentId ? { toggleParentId: parentId } : {}) }
        next.splice(index + 1, 0, { ...current[index], text: split.afterHtml })
        focusIndex = index + 1
      } else if (isListBlock(block)) {
        next[index] = { ...block, text: split.beforeHtml }
        next.splice(index + 1, 0, listContinuationBlock(block, split.afterHtml))
      } else {
        next[index] = { ...next[index], text: split.beforeHtml }
        next.splice(index + 1, 0, { type: "paragraph", text: split.afterHtml, ...(parentId ? { toggleParentId: parentId } : {}) })
      }

      const updatedCurrentBlock = next[index]
      if (!getImageBlockData(updatedCurrentBlock.text)) {
        el.innerHTML = updatedCurrentBlock.text
      }
      nextKeys.splice(index + 1, 0, makeBlockKey())
      commitBlocks(note.id, next)
      applyBlockKeys(nextKeys)
      clearBlockSelection()
      setTimeout(() => {
        focusBlock(focusIndex, "start")
      }, 0)
    }
    if (e.key === "Backspace" && isEmptyHtml(el.innerHTML)) {
      e.preventDefault()
      if (blocks.length <= 1) return
      deleteBlockIndexes(new Set([index]))
    }
  }, [applyBlockKeys, blockKeys, blocks, clearBlockSelection, commitBlocks, deleteBlockIndexes, domSave, editingMode, focusBlock, makeBlockKey, note, readBlocksFromDom, selectedBlockIndexes])

  const insertBlockAt = useCallback((index: number) => {
    if (!note) return
    const newBlock: NoteBlock = { type: "paragraph", text: "" }
    const current = readBlocksFromDom()
    const next = [...current]
    const nextKeys = blockKeys.length === current.length
      ? [...blockKeys]
      : current.map(() => makeBlockKey())
    next.splice(index, 0, newBlock)
    nextKeys.splice(index, 0, makeBlockKey())
    commitBlocks(note.id, next)
    applyBlockKeys(nextKeys)
    clearBlockSelection()
    setTimeout(() => {
      focusBlock(index)
    }, 0)
  }, [applyBlockKeys, blockKeys, clearBlockSelection, commitBlocks, focusBlock, makeBlockKey, note, readBlocksFromDom])

  const handleEditorMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!editingMode || e.button !== 0) return
    const target = e.target as Element

    if (
      target.closest('[data-editor-control="true"]') ||
      target.closest('[data-editor-ignore-mousedown="true"]') ||
      target.closest("button, input, textarea")
    ) {
      return
    }

    if (target.closest('[data-editor-block="true"]')) {
      return
    }

    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const row = target.closest<HTMLElement>("[data-editor-row-index]")

    const getStartIndex = () => {
      if (row?.dataset.editorRowIndex) return Number(row.dataset.editorRowIndex)
      const rows = getBlockRows()
      if (rows.length === 0) return 0
      for (const item of rows) {
        if (startY < item.rect.top + item.rect.height / 2) return item.index
      }
      return rows[rows.length - 1].index
    }

    const handleClick = () => {
      if (row?.dataset.editorRowIndex) {
        const index = Number(row.dataset.editorRowIndex)
        const el = blockRefs.current[index]
        if (el) {
          el.focus()
          activeBlockRef.current = index
          setActiveBlockIndex(index)
          const range = document.caretRangeFromPoint(startX, startY)
          if (range) {
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          }
        }
        return
      }

      if (blocks.length === 0) {
        insertBlockAt(0)
        return
      }

      const isEmptyNote =
        blocks.length === 1 &&
        !blocks[0].text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim()

      if (isEmptyNote) {
        focusBlock(0)
        return
      }

      const visibleBlockRects = blockRefs.current
        .map((el, index) => (el ? { index, rect: el.getBoundingClientRect() } : null))
        .filter((item): item is { index: number; rect: DOMRect } => item !== null)

      if (visibleBlockRects.length === 0) {
        insertBlockAt(0)
        return
      }

      for (let i = 0; i < visibleBlockRects.length; i += 1) {
        const current = visibleBlockRects[i]
        const next = visibleBlockRects[i + 1]

        if (startY < current.rect.top) {
          focusBlock(current.index)
          return
        }

        if (startY >= current.rect.top && startY <= current.rect.bottom) {
          focusBlock(current.index)
          return
        }

        if (next && startY > current.rect.bottom && startY < next.rect.top) {
          focusBlock(next.index)
          return
        }
      }

      const lastBlock = blocks[blocks.length - 1]
      if (lastBlock && !lastBlock.toggleParentId && isEmptyHtml(lastBlock.text)) {
        focusBlock(blocks.length - 1)
        return
      }

      insertBlockAt(blocks.length)
    }

    let boxSelectionStarted = false
    const handleMouseMove = (mouseEvent: MouseEvent) => {
      if (boxSelectionStarted) return
      const movedX = Math.abs(mouseEvent.clientX - startX)
      const movedY = Math.abs(mouseEvent.clientY - startY)
      if (movedX < 4 && movedY < 4) return

      boxSelectionStarted = true
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      startBlockBoxSelection(getStartIndex(), startX, startY, mouseEvent.clientX, mouseEvent.clientY)
    }

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      if (!boxSelectionStarted) handleClick()
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
  }, [blocks, editingMode, focusBlock, getBlockRows, insertBlockAt, startBlockBoxSelection])

  const changeBlockType = useCallback((index: number, type: NoteBlock["type"]) => {
    if (!note) return
    const current = readBlocksFromDom()
    const next = current.map((b, i) => {
      if (i !== index) return b
      if (type === "toggle") {
        return toToggleBlock(b, b.toggleId ?? makeToggleId())
      }
      return toTypedBlock(b, type)
    })
    commitBlocks(note.id, next)
  }, [commitBlocks, note, readBlocksFromDom])

  const toggleBlockCollapsed = useCallback((index: number) => {
    if (!note) return
    const current = readBlocksFromDom()
    if (current[index]?.type !== "toggle") return
    const next = current.map((block, i) => (
      i === index ? { ...block, collapsed: !block.collapsed } : block
    ))
    commitBlocks(note.id, next, { recordHistory: false })
    clearBlockSelection()
    activeBlockRef.current = index
    setActiveBlockIndex(index)
  }, [clearBlockSelection, commitBlocks, note, readBlocksFromDom])

  const toggleCodeLineNumbers = useCallback((index: number) => {
    if (!note) return
    const current = readBlocksFromDom()
    if (current[index]?.type !== "code") return
    const next = current.map((block, i) => (
      i === index ? { ...block, showLineNumbers: !block.showLineNumbers } : block
    ))
    commitBlocks(note.id, next, { recordHistory: false })
    activeBlockRef.current = index
    setActiveBlockIndex(index)
  }, [commitBlocks, note, readBlocksFromDom])

  const handleToolbarCommand = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value)
    domSave()
  }, [domSave])

  const insertBlocksAtActiveBlock = useCallback((nextBlocks: NoteBlock[]) => {
    if (!note || nextBlocks.length === 0) return false
    const current = readBlocksFromDom()
    const currentKeys = blockKeys.length === current.length
      ? [...blockKeys]
      : current.map(() => makeBlockKey())
    const activeIndex = activeBlockRef.current
    const insertIndex = activeIndex === null ? current.length : activeIndex + 1
    const activeBlock = activeIndex === null ? null : current[activeIndex]
    let inheritedToggleParentId = activeBlock?.toggleParentId
    if (activeIndex !== null && activeBlock?.type === "toggle" && activeBlock.toggleId) {
      inheritedToggleParentId = activeBlock.toggleId
      current[activeIndex] = toToggleBlock(activeBlock, inheritedToggleParentId)
    }
    const replaceEmptyActiveBlock =
      activeIndex !== null &&
      current[activeIndex]?.type === "paragraph" &&
      !getImageBlockData(current[activeIndex].text) &&
      isEmptyHtml(current[activeIndex].text)

    const targetIndex = replaceEmptyActiveBlock ? activeIndex : insertIndex
    const blocksToInsert = nextBlocks.map((block) => ({
      ...block,
      ...(inheritedToggleParentId ? { toggleParentId: inheritedToggleParentId } : {}),
    }))
    const keysToInsert = blocksToInsert.map(() => makeBlockKey())

    if (replaceEmptyActiveBlock) {
      current.splice(targetIndex, 1, ...blocksToInsert)
      currentKeys.splice(targetIndex, 1, ...keysToInsert)
    } else {
      current.splice(targetIndex, 0, ...blocksToInsert)
      currentKeys.splice(targetIndex, 0, ...keysToInsert)
    }

    commitBlocks(note.id, current)
    applyBlockKeys(currentKeys)
    clearBlockSelection()
    activeBlockRef.current = targetIndex
    setActiveBlockIndex(targetIndex)
    return true
  }, [applyBlockKeys, blockKeys, clearBlockSelection, commitBlocks, makeBlockKey, note, readBlocksFromDom])

  const insertAttachmentLink = useCallback((href: string, label: string): boolean => {
    const safeUrl = normalizeUrl(href, ["http:", "https:"], { keepSameOriginRelative: true })
    if (!safeUrl) return false
    restoreSelection()
    const link = document.createElement("a")
    link.href = safeUrl
    link.textContent = label || "附件"
    link.rel = "noopener noreferrer"
    link.className = "underline underline-offset-2"
    handleToolbarCommand("insertHTML", link.outerHTML)
    return true
  }, [handleToolbarCommand, restoreSelection])

  const insertLink = useCallback((href: string): boolean => {
    if (!note) return false
    restoreSelection()
    const selection = window.getSelection()
    const activeIndex = activeBlockRef.current
    const activeBlock = activeIndex === null ? null : blockRefs.current[activeIndex]
    if (!selection || selection.rangeCount === 0 || !activeBlock) return false

    const range = selection.getRangeAt(0)
    if (!activeBlock.contains(range.commonAncestorContainer)) return false

    pushUndoSnapshot(note.id, blocksRef.current)
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.rel = "noopener noreferrer"
    if (href.startsWith("http://") || href.startsWith("https://")) {
      anchor.target = "_blank"
    }

    if (range.collapsed) {
      anchor.textContent = href
      range.insertNode(anchor)
    } else {
      try {
        range.surroundContents(anchor)
      } catch {
        const fragment = range.extractContents()
        anchor.append(fragment)
        range.insertNode(anchor)
      }
    }

    const nextRange = document.createRange()
    nextRange.setStartAfter(anchor)
    nextRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(nextRange)
    savedSelectionRef.current = nextRange.cloneRange()
    domSave()
    return true
  }, [domSave, note, pushUndoSnapshot, restoreSelection])

  const uploadAndInsertImages = useCallback(async (files: File[]) => {
    const supportedFiles = files.filter(isSupportedImageFile)
    if (!note || supportedFiles.length === 0 || imageUploadPending) return

    setImageUploadPending(true)
    try {
      const imageFiles = await dedupeImageFiles(supportedFiles)
      const assets: Asset[] = []
      for (const file of imageFiles) {
        assets.push(await uploadAsset(file))
      }

      if (!insertBlocksAtActiveBlock(assets.map(assetToImageBlock))) {
        toast("图片插入失败", "error")
      } else {
        toast(assets.length === 1 ? "图片已上传" : `已上传 ${assets.length} 张图片`, "success")
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "图片上传失败", "error")
    } finally {
      setImageUploadPending(false)
    }
  }, [imageUploadPending, insertBlocksAtActiveBlock, note, toast])

  const uploadAndInsertClipboard = useCallback(async (clipboardHtml: string, clipboardText: string, files: File[]) => {
    const supportedFiles = files.filter(isSupportedImageFile)
    if (!note || supportedFiles.length === 0 || imageUploadPending) return

    setImageUploadPending(true)
    try {
      const imageFiles = await dedupeImageFiles(supportedFiles)
      const assets: Asset[] = []
      for (const file of imageFiles) {
        assets.push(await uploadAsset(file))
      }

      const pasteBlocks = buildPasteBlocksWithAssets(clipboardHtml, clipboardText, assets)
      if (pasteBlocks.length === 0) {
        toast("粘贴内容为空", "error")
        return
      }

      if (!insertBlocksAtActiveBlock(pasteBlocks)) {
        toast("粘贴失败", "error")
        return
      }
      toast(assets.length === 1 ? "已粘贴文字和图片" : `已粘贴文字和 ${assets.length} 张图片`, "success")
    } catch (error) {
      toast(error instanceof Error ? error.message : "图片上传失败", "error")
    } finally {
      setImageUploadPending(false)
    }
  }, [imageUploadPending, insertBlocksAtActiveBlock, note, toast])

  const openLinkDialog = useCallback(() => {
    captureSelection()
    setLinkDialogOpen(true)
  }, [captureSelection])

  const openImageDialog = useCallback(() => {
    captureSelection()
    setImageDialogError("")
    setImageUrlDraft("")
    setImageDialogOpen(true)
  }, [captureSelection])

  const closeImageDialog = useCallback(() => {
    if (imageUploadPending) return
    setImageDialogOpen(false)
    setImageDialogError("")
    setImageUrlDraft("")
  }, [imageUploadPending])

  const submitImageUrl = useCallback(() => {
    if (!note) return
    const safeUrl = normalizeUrl(imageUrlDraft, ["http:", "https:"], { keepSameOriginRelative: true })
    if (!safeUrl || !insertBlocksAtActiveBlock([imageToBlock(safeUrl, "")])) {
      setImageDialogError("图片地址无效")
      return
    }
    closeImageDialog()
    toast("已插入图片", "success")
  }, [closeImageDialog, imageUrlDraft, insertBlocksAtActiveBlock, note, toast])

  const handleImageFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return
    setImageDialogError("")
    setImageUploadPending(true)
    try {
      const asset = await uploadAsset(file)
      if (!insertBlocksAtActiveBlock([assetToImageBlock(asset)])) {
        setImageDialogError("图片地址无效")
        return
      }
      closeImageDialog()
      toast("图片已上传", "success")
    } catch (error) {
      setImageDialogError(error instanceof Error ? error.message : "图片上传失败")
    } finally {
      setImageUploadPending(false)
    }
  }, [closeImageDialog, insertBlocksAtActiveBlock, toast])

  const handleBlockPaste = useCallback((index: number, event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!editingMode || imageUploadPending) return

    const clipboardHtml = event.clipboardData.getData("text/html")
    const clipboardText = event.clipboardData.getData("text/plain")
    if (blocksRef.current[index]?.type === "code") {
      event.preventDefault()
      document.execCommand("insertText", false, clipboardText)
      domSave()
      return
    }

    const files = getImageFilesFromDataTransfer(event.clipboardData)
    const htmlImageFiles = files.length > 0
      ? []
      : getImageFilesFromHtml(clipboardHtml)
    const imageFiles = [...files, ...htmlImageFiles]
    const hasImageHtml = clipboardHtmlHasImages(clipboardHtml)
    const pasteBlocks = buildPasteBlocksWithAssets(clipboardHtml, clipboardText, [])
    const activeBlockIsEmpty = isEmptyHtml(blocksRef.current[index]?.text ?? "")
    const shouldPasteAsBlocks =
      imageFiles.length > 0 ||
      hasImageHtml ||
      pasteBlocks.length > 1 ||
      (activeBlockIsEmpty && clipboardHtmlHasBlockContent(clipboardHtml)) ||
      clipboardTextHasMultipleBlocks(clipboardText)

    if (!shouldPasteAsBlocks) return

    event.preventDefault()
    activeBlockRef.current = index
    setActiveBlockIndex(index)
    clearBlockSelection()
    captureSelection()

    if (imageFiles.length > 0) {
      void uploadAndInsertClipboard(clipboardHtml, clipboardText, imageFiles)
      return
    }

    if (pasteBlocks.length === 0 || !insertBlocksAtActiveBlock(pasteBlocks)) {
      toast("粘贴失败", "error")
      return
    }
    toast(hasImageHtml ? "已粘贴文字和图片" : "已粘贴内容", "success")
  }, [captureSelection, clearBlockSelection, domSave, editingMode, imageUploadPending, insertBlocksAtActiveBlock, toast, uploadAndInsertClipboard])

  const handleBlockClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const link = target.closest<HTMLAnchorElement>("a[href]")
    if (!link || !event.currentTarget.contains(link)) return

    const safeUrl = normalizeUrl(link.getAttribute("href") || "", ["http:", "https:", "mailto:", "tel:"], {
      keepSameOriginRelative: true,
    })
    if (!safeUrl) return

    event.preventDefault()
    event.stopPropagation()
    window.open(safeUrl, "_blank", "noopener,noreferrer")
  }, [])

  const handleEditorImageDrop = useCallback((event: React.DragEvent<HTMLDivElement>): boolean => {
    if (!editingMode || imageUploadPending) return false

    const imageFiles = getImageFilesFromDataTransfer(event.dataTransfer)
    if (imageFiles.length === 0) return false

    event.preventDefault()
    event.stopPropagation()
    draggedBlockIndexRef.current = null
    dragInsertIndexRef.current = null
    setDragInsertIndex(null)

    const target = event.target instanceof Element ? event.target : null
    const blockEl = target?.closest<HTMLDivElement>('[data-editor-block="true"]') ?? null
    const rowEl = target?.closest<HTMLElement>("[data-editor-row-index]") ?? null
    const rowIndex = rowEl ? Number(rowEl.dataset.editorRowIndex) : null
    const fallbackBlock = blockEl ?? (
      rowIndex !== null && Number.isInteger(rowIndex) ? blockRefs.current[rowIndex] : null
    )

    if (rowIndex !== null && Number.isInteger(rowIndex)) {
      activeBlockRef.current = rowIndex
      setActiveBlockIndex(rowIndex)
    }
    clearBlockSelection()
    if (fallbackBlock) {
      placeCaretAtPoint(event.clientX, event.clientY, fallbackBlock)
    }
    captureSelection()
    void uploadAndInsertImages(imageFiles)
    return true
  }, [captureSelection, clearBlockSelection, editingMode, imageUploadPending, uploadAndInsertImages])

  const handleAttachmentFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file || attachmentUploadPending) return
    captureSelection()
    setAttachmentUploadPending(true)
    try {
      const asset = await uploadAsset(file)
      if (note) pushUndoSnapshot(note.id, blocksRef.current)
      if (!insertAttachmentLink(asset.url, asset.filename)) {
        toast("附件链接无效", "error")
        return
      }
      toast("附件已上传", "success")
    } catch (error) {
      toast(error instanceof Error ? error.message : "附件上传失败", "error")
    } finally {
      setAttachmentUploadPending(false)
    }
  }, [attachmentUploadPending, captureSelection, insertAttachmentLink, note, pushUndoSnapshot, toast])

  const handleHeadingClick = useCallback(() => {
    const idx = activeBlockRef.current
    if (idx === null || !blocks[idx]) return
    const current = blocks[idx].type
    const nextType: NoteBlock["type"] = current === "heading" ? "paragraph" : "heading"
    changeBlockType(idx, nextType)
  }, [blocks, changeBlockType])

  const handleListClick = useCallback(() => {
    const idx = activeBlockRef.current
    if (idx === null || !blocks[idx]) return
    const current = blocks[idx].type
    const nextType: NoteBlock["type"] = current === "bullet" ? "paragraph" : "bullet"
    changeBlockType(idx, nextType)
  }, [blocks, changeBlockType])

  const handleOrderedClick = useCallback(() => {
    const idx = activeBlockRef.current
    if (idx === null || !blocks[idx]) return
    const current = blocks[idx].type
    const nextType: NoteBlock["type"] = current === "ordered" ? "paragraph" : "ordered"
    changeBlockType(idx, nextType)
  }, [blocks, changeBlockType])

  const handleTodoClick = useCallback(() => {
    const idx = activeBlockRef.current
    if (idx === null || !blocks[idx]) return
    const current = blocks[idx].type
    const nextType: NoteBlock["type"] = current === "todo" ? "paragraph" : "todo"
    changeBlockType(idx, nextType)
  }, [blocks, changeBlockType])

  const handleQuoteClick = useCallback(() => {
    const idx = activeBlockRef.current
    if (idx === null || !blocks[idx]) return
    const current = blocks[idx].type
    const nextType: NoteBlock["type"] = current === "quote" ? "paragraph" : "quote"
    changeBlockType(idx, nextType)
  }, [blocks, changeBlockType])

  const handleCodeClick = useCallback(() => {
    const idx = activeBlockRef.current
    if (idx === null || !blocks[idx]) return
    const current = blocks[idx].type
    const nextType: NoteBlock["type"] = current === "code" ? "paragraph" : "code"
    changeBlockType(idx, nextType)
  }, [blocks, changeBlockType])

  const handleAlignClick = useCallback(() => {
    const idx = activeBlockRef.current
    if (idx === null) return
    const el = blockRefs.current[idx]
    if (el) {
      const current = el.style.textAlign
      el.style.textAlign = current === "center" ? "left" : "center"
      domSave()
    }
  }, [domSave])

  const handleClearFormatting = useCallback(() => {
    const idx = activeBlockRef.current
    if (idx === null) return
    const el = blockRefs.current[idx]
    if (el) {
      document.execCommand("removeFormat")
      domSave()
    }
  }, [domSave])

  const handleTocMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = tocWidth

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      setTocWidth(Math.max(TOC_MIN_WIDTH, Math.min(TOC_MAX_WIDTH, startWidth.current + startX.current - e.clientX)))
    }

    const handleMouseUp = () => {
      dragging.current = false
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [tocWidth])

  const headings = blocks
    .map((block, index) => block.type === "heading" ? { text: block.text, index, level: getHeadingLevel(block) } : null)
    .filter((item): item is { text: string; index: number; level: HeadingLevel } => item !== null)
  const tocHeadings = getTocHeadings(headings)
  const visibleTocHeadings = getVisibleTocHeadings(tocHeadings, collapsedTocHeadingIds)
  const collapsibleTocHeadingIndexes = tocHeadings
    .filter((heading) => heading.hasChildren)
    .map((heading) => heading.index)
  const allTocHeadingsCollapsed = collapsibleTocHeadingIndexes.length > 0 &&
    collapsibleTocHeadingIndexes.every((index) => collapsedTocHeadingIds.has(index))

  const toggleTocHeading = useCallback((index: number) => {
    setCollapsedTocHeadingIds((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const toggleAllTocHeadings = () => {
    setCollapsedTocHeadingIds((prev) => {
      const next = new Set(prev)
      const allCollapsed = collapsibleTocHeadingIndexes.length > 0 &&
        collapsibleTocHeadingIndexes.every((index) => next.has(index))

      collapsibleTocHeadingIndexes.forEach((index) => {
        if (allCollapsed) next.delete(index)
        else next.add(index)
      })

      return next
    })
  }

  const handleTocClick = useCallback((index: number) => {
    const el = blockRefs.current[index]
    const container = scrollContainerRef.current
    if (!el) return

    if (!container) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }

    const containerRect = container.getBoundingClientRect()
    const blockRect = el.getBoundingClientRect()
    const topOffset = 12
    container.scrollTo({
      top: Math.max(0, container.scrollTop + blockRect.top - containerRect.top - topOffset),
      behavior: "smooth",
    })
  }, [])

  const updateReadingProgress = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) {
      setReadingProgress(0)
      setActiveTocHeadingIndex(null)
      return
    }

    const maxScroll = el.scrollHeight - el.clientHeight
    setReadingProgress(maxScroll <= 0 ? 0 : Math.min(100, Math.max(0, (el.scrollTop / maxScroll) * 100)))

    const containerRect = el.getBoundingClientRect()
    const activationTop = containerRect.top + Math.min(160, Math.max(96, el.clientHeight * 0.22))
    let nextActive: number | null = null
    let firstVisible: number | null = null

    blocksRef.current.forEach((block, index) => {
      if (block.type !== "heading") return
      const headingEl = blockRefs.current[index]
      if (!headingEl) return

      const rect = headingEl.getBoundingClientRect()
      if (firstVisible === null && rect.bottom >= containerRect.top && rect.top <= containerRect.bottom) {
        firstVisible = index
      }
      if (rect.top <= activationTop) {
        nextActive = index
      }
    })

    setActiveTocHeadingIndex((prev) => {
      const resolved = nextActive ?? firstVisible
      return prev === resolved ? prev : resolved
    })
  }, [])

  useEffect(() => {
    updateReadingProgress()
  }, [note?.id, blocks.length, tocOpen, updateReadingProgress])

  const handlePublicShare = useCallback(async () => {
    if (!note || publicSharePending) return
    setPublicSharePending(true)
    try {
      const result = await createPublicNoteShareLink(note.id)
      await copyText(result.url)
      setShareMenuOpen(false)
      toast("公开链接已复制", "success")
    } catch {
      toast("生成公开链接失败", "error")
    } finally {
      setPublicSharePending(false)
    }
  }, [note, publicSharePending, toast])

  const handleCollaboratorShare = useCallback(() => {
    setShareMenuOpen(false)
    toast("添加协作者功能稍后开放", "info")
  }, [toast])

  const handleShare = useCallback(() => {
    if (!note) return
    setShareMenuOpen((open) => !open)
  }, [note])

  const handleEditingModeAction = useCallback(() => {
    if (!note) return
    if (!editingMode) {
      setEditingMode(true)
      return
    }

    const updated = readBlocksFromDom()
    blocksRef.current = updated
    setBlocks(updated)
    saveBlocks(note.id, updated)
    flushBlockSaveRef.current(note.id)
    setEditingMode(false)
    toast("已保存", "success")
  }, [editingMode, note, readBlocksFromDom, saveBlocks, toast])

  useEffect(() => {
    const hidden = getCollapsedBlockIndexes(blocks)
    hidden.forEach((index) => {
      blockRefs.current[index] = null
    })
  }, [blocks])

  const hiddenBlockIndexes = getCollapsedBlockIndexes(blocks)
  const toggleChildLayouts = getToggleChildLayouts(blocks)
  const toggleBodyCounts = getToggleBodyCounts(blocks)

  if (!note) {
    return (
      <section className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="app-drag-region flex h-14 min-w-0 items-center gap-1 overflow-hidden border-b border-border px-3 sm:px-4">
          <ToolbarButton onClick={onToggleSidebar} active={sidebarOpen} label="切换侧栏">
            <PanelLeft className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={onToggleNoteList} active={noteListOpen} label="切换笔记列表">
            <Columns3 className="h-4 w-4" />
          </ToolbarButton>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">选择一篇笔记开始阅读</p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      {/* 文档栏 */}
      <div className="app-drag-region flex h-12 min-w-0 items-center gap-3 overflow-visible border-b border-border px-2.5 sm:px-4">
        <div className="app-no-drag flex shrink-0 items-center gap-1">
          <ToolbarButton onClick={onToggleSidebar} active={sidebarOpen} activeStyle="strong" label="切换侧栏">
            <PanelLeft className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={onToggleNoteList} active={noteListOpen} activeStyle="strong" label="切换笔记列表">
            <Columns3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => setTocOpen((v) => !v)} active={tocOpen} activeStyle="strong" label="切换大纲">
            <PanelRight className="h-4 w-4" />
          </ToolbarButton>
        </div>
        <span className="h-5 w-px shrink-0 bg-border" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{note.title}</p>
        </div>
        <div className="app-no-drag flex shrink-0 items-center gap-1.5">
          <ToolbarButton
            onClick={() => { void onUpdateNote(note.id, { starred: !note.starred }).catch(() => {}) }}
            active={note.starred}
            activeStyle="strong"
            label={note.starred ? "取消收藏" : "收藏"}
          >
            <Star className={cn("h-4 w-4", note.starred && "fill-primary")} />
          </ToolbarButton>
          <div ref={shareMenuRef} className="relative">
            <ToolbarButton onClick={handleShare} active={shareMenuOpen} activeStyle="strong" label="分享">
              <Share2 className="h-4 w-4" />
            </ToolbarButton>
            {shareMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-44 origin-top-right rounded-[8px] border border-border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg shadow-black/20 animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150">
                <button
                  type="button"
                  onClick={handleCollaboratorShare}
                  className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <UserPlus className="h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate">添加协作者</span>
                </button>
                <button
                  type="button"
                  onClick={() => { void handlePublicShare() }}
                  disabled={publicSharePending}
                  className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-popover-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50"
                >
                  {publicSharePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
                  <span className="min-w-0 flex-1 truncate">互联网公开</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleEditingModeAction}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[6px] border border-border px-3 text-sm font-medium transition-colors",
              editingMode ? "bg-foreground text-background hover:opacity-90" : "text-foreground hover:bg-accent",
            )}
          >
            {editingMode ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editingMode ? "保存" : "编辑"}
          </button>
        </div>
      </div>

      {editingMode && (
        <>
          {/* 格式工具栏 */}
          <div className="app-drag-region flex h-11 min-w-0 items-center gap-2 overflow-hidden border-b border-border px-2 sm:px-4">
            <div className={cn("scrollbar-hidden flex min-w-0 flex-1 items-center gap-1 overflow-x-auto", !sidebarOpen && !noteListOpen ? "justify-center" : "")}>
          <ToolbarButton onClick={handleHeadingClick} active={activeType === "heading"} label="标题">
            <Heading className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => handleToolbarCommand("bold")} active={inlineFormats.bold} label="粗体">
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => handleToolbarCommand("italic")} active={inlineFormats.italic} label="斜体">
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => handleToolbarCommand("underline")} active={inlineFormats.underline} label="下划线">
            <Underline className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1.5 h-5 w-px shrink-0 bg-border" />
          <ToolbarButton onClick={handleOrderedClick} active={activeType === "ordered"} label="有序列表">
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={handleListClick} active={activeType === "bullet"} label="无序列表">
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={handleTodoClick} active={activeType === "todo"} label="任务列表">
            <ListChecks className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={handleAlignClick} label="对齐">
            <AlignLeft className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={handleQuoteClick} active={activeType === "quote"} label="引用">
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={handleCodeClick} active={activeType === "code"} label="代码块">
            <Code2 className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1.5 h-5 w-px shrink-0 bg-border" />
          <ToolbarButton onClick={openLinkDialog} label="插入链接">
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={openImageDialog} label="插入图片">
            <ImageIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => attachmentInputRef.current?.click()} label="上传附件">
            {attachmentUploadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </ToolbarButton>
          <ToolbarButton onClick={() => {
            handleToolbarCommand("insertHTML", '<table class="w-full border-collapse border border-border"><tr><td class="border border-border p-2">&nbsp;</td><td class="border border-border p-2">&nbsp;</td></tr><tr><td class="border border-border p-2">&nbsp;</td><td class="border border-border p-2">&nbsp;</td></tr></table>')
            toast("已插入表格", "success")
          }} label="插入表格">
            <Table className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1.5 h-5 w-px shrink-0 bg-border" />
          <ToolbarButton onClick={handleClearFormatting} label="清除格式">
            <RemoveFormatting className="h-4 w-4" />
          </ToolbarButton>
            </div>
            <div className="flex min-w-max shrink-0 items-center gap-2">
              <ToolbarButton onClick={undoBlocks} label="撤销">
                <Undo2 className="h-4 w-4" />
              </ToolbarButton>
            </div>
          </div>
        </>
      )}

      <div className="flex h-0.5 shrink-0">
        <div className="min-w-0 flex-1 bg-border/30">
          <div
            className="h-full bg-foreground/45"
            style={{ width: `${readingProgress}%` }}
          />
        </div>
        <div style={{ width: tocWidth }} className="hidden shrink-0 xl:block" />
      </div>

      <div ref={editorSurfaceRef} className="flex min-w-0 flex-1 overflow-hidden">
        {/* 正文 */}
        <div
          ref={scrollContainerRef}
          onMouseDown={handleEditorMouseDown}
          onScroll={updateReadingProgress}
          className="scrollbar-hidden min-w-0 flex-1 overflow-y-auto"
        >
          <article
            className="mx-auto px-0 py-8 sm:py-10"
            style={{ width: EDITOR_ARTICLE_WIDTH, maxWidth: EDITOR_ARTICLE_MAX_WIDTH }}
          >
            {/* 标题 */}
            <div data-editor-ignore-mousedown="true" className="flex min-w-0 items-start">
              <div className="min-w-0 flex-1">
                {editingTitle ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
	                    onBlur={() => {
	                      setEditingTitle(false)
	                      if (titleDraft.trim() && titleDraft !== note.title) {
	                        void onUpdateNote(note.id, { title: titleDraft }).catch(() => {})
	                      }
	                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                    }}
                    className="w-full bg-transparent text-3xl font-bold tracking-tight text-foreground outline-none"
                  />
                ) : (
                  <h1
                    onClick={() => {
                      if (!editingMode) return
                      setTitleDraft(note.title)
                      setEditingTitle(true)
                    }}
                    className={cn("break-words text-pretty text-3xl font-bold tracking-tight text-foreground", editingMode && "cursor-text")}
                  >
                    {note.title}
                  </h1>
                )}
              </div>
            </div>

            {/* 元信息 */}
            <div data-editor-ignore-mousedown="true" className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <BookOpen className="h-3.5 w-3.5" />
                {note.notebook}
              </span>
              <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {note.date}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {note.tags.map((tag) => (
                  <span key={tag} className="group flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                    {tag}
	                    <button
	                      type="button"
	                      onClick={() => {
                          if (!editingMode) return
                          void onUpdateNote(note.id, { tags: note.tags.filter((t) => t !== tag) }).catch(() => {})
                        }}
	                      aria-label={`删除标签 ${tag}`}
                        disabled={!editingMode}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {editingMode && <X className="h-3 w-3" />}
                    </button>
                  </span>
                ))}
                {editingMode && (
                  <button
                    type="button"
                    onClick={() => setTagDialogOpen(true)}
                    className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 transition-colors hover:bg-accent"
                  >
                    <Tag className="h-3.5 w-3.5" />
                    添加标签
                  </button>
                )}
              </div>
            </div>

            {/* 内容块 */}
            <div
              ref={editorBlocksRef}
              onDragOver={(event) => {
                if (dataTransferHasSupportedImage(event.dataTransfer)) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "copy"
                  return
                }
                if (draggedBlockIndexRef.current === null) return
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
                const nextInsertIndex = getDragInsertIndex(event.clientY, event.currentTarget)
                dragInsertIndexRef.current = nextInsertIndex
                setDragInsertIndex(nextInsertIndex)
              }}
              onDrop={(event) => {
                if (handleEditorImageDrop(event)) return
                if (draggedBlockIndexRef.current === null) return
                event.preventDefault()
                const nextInsertIndex = dragInsertIndexRef.current ?? getDragInsertIndex(event.clientY, event.currentTarget)
                reorderBlock(draggedBlockIndexRef.current, nextInsertIndex)
                draggedBlockIndexRef.current = null
                dragInsertIndexRef.current = null
                setDragInsertIndex(null)
              }}
              className={cn(
                "relative mt-8 flex min-h-[45vh] flex-col",
                editingMode ? "cursor-text gap-4" : "gap-2",
                blockSelectionDragging && "select-none cursor-default",
              )}
            >
              {blockSelectionBox && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute z-20 rounded-[6px] bg-[#dcecff]/55 dark:bg-[#173b60]/55"
                  style={{
                    left: blockSelectionBox.left,
                    top: blockSelectionBox.top,
                    width: blockSelectionBox.width,
                    height: blockSelectionBox.height,
                  }}
                />
              )}
              {blocks.map((block, i) => {
                if (hiddenBlockIndexes.has(i)) return null
                const isHeading = block.type === "heading"
                const isBullet = block.type === "bullet"
                const isOrdered = block.type === "ordered"
                const isTodo = block.type === "todo"
                const isQuote = block.type === "quote"
                const isCode = block.type === "code"
                const isHighlight = block.type === "highlight"
                const isColumns = block.type === "columns"
                const isToggle = block.type === "toggle"
                const listIndent = isListBlock(block) ? getBlockIndent(block) : 0
                const isListItem = isListBlock(block)
                const listGroupIndexes = isListItem ? getListGroupIndexes(i, blocks) : [i]
                const isListGroupStart = isListItem && listGroupIndexes[0] === i
                const isListGroupEnd = isListItem && listGroupIndexes[listGroupIndexes.length - 1] === i
                const showListBlockControls = !isListItem || isListGroupStart
                const toggleChildLayout = toggleChildLayouts.get(i)
                const toggleHasBody = isToggle && (toggleBodyCounts.get(i) ?? 0) > 0
                const toggleExpandedWithBody = isToggle && !block.collapsed && toggleHasBody
                const headingLevel = isHeading ? getHeadingLevel(block) : 1
                const orderedNumber = isOrdered ? getOrderedListNumber(blocks, i) : 0
                const isBlockSelected = selectedBlockIndexes.has(i)
                const listGroupSelected = isListItem && listGroupIndexes.every((index) => selectedBlockIndexes.has(index))
                const showBlockHoverSurface = !isListItem && !isBlockSelected && handleHoverIndex === i
                const showHeadingMarker = isHeading && (activeBlockIndex === i || isBlockSelected)
                const showInsertBefore = dragInsertIndex === i
                const showInsertAfter = dragInsertIndex === blocks.length && i === blocks.length - 1
                const imageBlock = block.type === "paragraph" ? getImageBlockData(block.text) : null
                const codeLineCount = isCode ? getCodeLineCount(block.text) : 1
                return (
                  <div
                    key={blockKeys[i] ?? i}
                    data-editor-row-index={i}
                    style={listIndent > 0 ? { paddingLeft: listIndent * LIST_INDENT_STEP_PX } : undefined}
                    onMouseDown={(event) => {
                      if (!(event.target instanceof Element)) return
                      if (event.target.closest('[data-editor-control="true"]')) return
                      activeBlockRef.current = i
                      setActiveBlockIndex(i)
                      if (!event.metaKey && !event.ctrlKey && !event.shiftKey) clearBlockSelection()
                    }}
                    onDragOver={(event) => {
                      if (draggedBlockIndexRef.current === null) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                      const rect = event.currentTarget.getBoundingClientRect()
                      const nextInsertIndex = event.clientY > rect.top + rect.height / 2 ? i + 1 : i
                      dragInsertIndexRef.current = nextInsertIndex
                      setDragInsertIndex(nextInsertIndex)
                    }}
                    onDrop={(event) => {
                      if (draggedBlockIndexRef.current === null) return
                      event.preventDefault()
                      event.stopPropagation()
                      const nextInsertIndex = dragInsertIndexRef.current ?? i
                      reorderBlock(draggedBlockIndexRef.current, nextInsertIndex)
                      draggedBlockIndexRef.current = null
                      dragInsertIndexRef.current = null
                      setDragInsertIndex(null)
                    }}
                    className={cn(
                      "group relative flex min-h-7 min-w-0 max-w-full items-start gap-2 rounded-[8px] transition-colors",
                      editingMode && "py-1",
                      !editingMode && "py-0.5",
                      isListItem && !isListGroupStart && (editingMode ? "-mt-4" : "-mt-2"),
                      showBlockHoverSurface && "bg-card/70 dark:bg-white/[0.04]",
                      isBlockSelected && "bg-[#dcecff]/85 dark:bg-[#173b60]/80",
                      isListItem && listGroupSelected && [
                        "rounded-none",
                        isListGroupStart && "rounded-t-[8px]",
                        isListGroupEnd && "rounded-b-[8px]",
                      ],
                      isToggle && "bg-card/80 px-2 py-2 dark:bg-white/[0.04]",
                      toggleExpandedWithBody && "rounded-b-none pb-1",
                      toggleChildLayout && [
                        editingMode ? "-mt-4" : "-mt-2",
                        "rounded-none bg-card/80 px-3 py-1 pl-10 dark:bg-white/[0.04]",
                        toggleChildLayout.isFirst && "pt-2",
                        toggleChildLayout.isLast && "rounded-b-[8px] pb-3",
                      ],
                      isQuote && "ml-0",
                      isCode && "items-stretch",
                    )}
                  >
                    {showInsertBefore && <BlockInsertIndicator />}
                    {editingMode && showListBlockControls && (
                      <span
                        data-editor-control="true"
                        onMouseDown={(event) => startBlockRangeSelection(i, event)}
                        aria-hidden="true"
                        className="absolute -left-28 top-0 z-[1] h-full w-28 cursor-default"
                      />
                    )}
                    {editingMode && showListBlockControls && (
                      <span
                        data-editor-control="true"
                        onMouseDown={(event) => startBlockRangeSelection(i, event)}
                        aria-hidden="true"
                        className="absolute -right-24 top-0 z-[1] h-full w-20 cursor-default"
                      />
                    )}
                    {editingMode && showListBlockControls && (
                      <button
                        type="button"
                        data-editor-control="true"
                        data-block-menu-trigger="true"
                        draggable
                        onClick={(event) => {
                          if (isListItem) {
                            event.preventDefault()
                            event.stopPropagation()
                            activeBlockRef.current = i
                            setActiveBlockIndex(i)
                            setSelectedBlockIndexes(new Set(listGroupIndexes))
                            lastSelectedBlockIndexRef.current = listGroupIndexes[listGroupIndexes.length - 1] ?? i
                          } else {
                            selectBlock(i, event)
                          }
                          setBlockMenuIndex((current) => current === i ? null : i)
                          setBlockTransformMenuOpen(false)
                        }}
                        onMouseEnter={() => setHandleHoverIndex(i)}
                        onMouseLeave={() => setHandleHoverIndex((current) => current === i ? null : current)}
                        onDragStart={(event) => {
                          setBlockMenuIndex(null)
                          setBlockTransformMenuOpen(false)
                          draggedBlockIndexRef.current = i
                          dragInsertIndexRef.current = i
                          event.dataTransfer.effectAllowed = "move"
                          event.dataTransfer.setData("text/plain", String(i))
                          const ghost = document.createElement("div")
                          ghost.style.width = "1px"
                          ghost.style.height = "1px"
                          ghost.style.opacity = "0"
                          ghost.style.position = "fixed"
                          ghost.style.top = "-9999px"
                          ghost.style.left = "-9999px"
                          document.body.appendChild(ghost)
                          event.dataTransfer.setDragImage(ghost, 0, 0)
                          window.setTimeout(() => ghost.remove(), 0)
                          if (isListItem) {
                            setSelectedBlockIndexes(new Set(listGroupIndexes))
                            lastSelectedBlockIndexRef.current = listGroupIndexes[listGroupIndexes.length - 1] ?? i
                          } else if (!selectedBlockIndexes.has(i)) {
                            setSelectedBlockIndexes(new Set([i]))
                            lastSelectedBlockIndexRef.current = i
                          } else {
                            lastSelectedBlockIndexRef.current = i
                          }
                          setHandleHoverIndex(null)
                          dragInsertIndexRef.current = i
                          setDragInsertIndex(i)
                        }}
                        onDragEnd={() => {
                          draggedBlockIndexRef.current = null
                          dragInsertIndexRef.current = null
                          setDragInsertIndex(null)
                          setHandleHoverIndex(null)
                        }}
                        aria-label="打开块菜单或拖动块"
                        title="打开块菜单或拖动块"
                        className={cn(
                          "absolute -left-7 top-1 z-10 flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-[6px] text-muted-foreground/45 opacity-0 transition-opacity hover:text-muted-foreground active:cursor-grabbing group-hover:opacity-100 focus:opacity-100",
                          blockMenuIndex === i && "opacity-100 text-muted-foreground",
                          isBlockSelected && "text-[#4f8fca] opacity-100 dark:text-[#9bc7ed]",
                        )}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                    )}
                    {editingMode && showListBlockControls && blockMenuIndex === i && (
                      <BlockActionMenu
                        menuRef={blockMenuRef}
                        block={block}
                        transformOpen={blockTransformMenuOpen}
                        onTransformOpenChange={setBlockTransformMenuOpen}
                        onTransform={(type, level) => transformBlockIndexes(getActionBlockIndexes(i), type, level)}
                        onDelete={() => {
                          const indexes = getActionBlockIndexes(i)
                          setBlockMenuIndex(null)
                          setBlockTransformMenuOpen(false)
                          deleteBlockIndexes(new Set(indexes))
                        }}
                        onCopy={() => {
                          const indexes = getActionBlockIndexes(i)
                          setBlockMenuIndex(null)
                          setBlockTransformMenuOpen(false)
                          void copyBlockIndexes(indexes)
                        }}
                        onCut={() => {
                          const indexes = getActionBlockIndexes(i)
                          setBlockMenuIndex(null)
                          setBlockTransformMenuOpen(false)
                          void cutBlockIndexes(indexes)
                        }}
                      />
                    )}
                    {isBullet && (
                      <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                    )}
                    {isOrdered && (
                      <span className="mt-[11px] min-w-[1.8em] shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {orderedNumber}.
                      </span>
                    )}
                    {isTodo && (
                      <span
                        data-editor-control="true"
                        onClick={() => {
                          if (!editingMode) return
                          const current = readBlocksFromDom()
                          const next = current.map((b, idx) =>
                            idx === i ? { ...b, checked: !b.checked } : b
                          )
                          commitBlocks(note.id, next)
                        }}
                        className={cn(
                          "mt-[6px] flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border",
                          block.checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {block.checked && <Check className="h-3 w-3" />}
                      </span>
                    )}
                    {showHeadingMarker && (
                      <span className="flex h-7 shrink-0 items-center text-muted-foreground/70">{"#".repeat(headingLevel)}</span>
                    )}
                    {isQuote && (
                      <span className="mt-[3px] text-lg leading-none text-muted-foreground select-none">&quot;</span>
                    )}
                    {isToggle && (
                      <button
                        type="button"
                        data-editor-control="true"
                        onPointerDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          toggleBlockCollapsed(i)
                        }}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        aria-expanded={!block.collapsed}
                        aria-label={block.collapsed ? "展开折叠块" : "收起折叠块"}
                        title={block.collapsed ? "展开折叠块" : "收起折叠块"}
                        className="relative z-30 -ml-0.5 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !block.collapsed && "rotate-90")} />
                      </button>
                    )}
                    {imageBlock ? (
                      <ImageBlock
                        refCallback={(el) => { blockRefs.current[i] = el }}
                        image={imageBlock}
                        editingMode={editingMode}
                        onInsertAfter={() => insertBlockAt(i + 1)}
                      />
                    ) : isCode ? (
                      <div className="group/code relative min-w-0 flex-1">
                        {block.showLineNumbers && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute left-0 top-2 z-[1] flex w-9 select-none flex-col items-end px-2 font-mono text-[12px] leading-6 text-muted-foreground/45"
                          >
                            {Array.from({ length: codeLineCount }, (_, lineIndex) => (
                              <span key={lineIndex} className="h-6 tabular-nums">{lineIndex + 1}</span>
                            ))}
                          </div>
                        )}
                        <div
                          data-editor-control="true"
                          className="pointer-events-none absolute right-1.5 top-1.5 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/code:pointer-events-auto group-hover/code:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
                        >
                          <CodeBlockToolButton
                            label="复制代码"
                            onClick={() => { void copyBlockIndexes([i]) }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </CodeBlockToolButton>
                          <CodeBlockToolButton
                            active={!!block.showLineNumbers}
                            label={block.showLineNumbers ? "隐藏行号" : "显示行号"}
                            onClick={() => toggleCodeLineNumbers(i)}
                          >
                            <ListOrdered className="h-3.5 w-3.5" />
                          </CodeBlockToolButton>
                        </div>
                        <EditableBlock
                          refCallback={(el) => { blockRefs.current[i] = el }}
                          data-editor-block="true"
                          onFocus={() => { activeBlockRef.current = i; setActiveBlockIndex(i); clearBlockSelection() }}
                          onInput={(e) => handleBlockInput(i, e)}
                          onBlur={handleBlockBlur}
                          onKeyDown={(e) => handleBlockKeyDown(i, e)}
                          onPaste={(e) => handleBlockPaste(i, e)}
                          onClick={handleBlockClick}
                          editable={editingMode}
                          className={cn(
                            "min-h-7 min-w-0 max-w-full flex-1 whitespace-pre-wrap break-words text-left decoration-[0.06em] underline-offset-[5px] outline-none [&_a]:cursor-pointer [&_a]:text-[#78bdf7] [&_a]:underline [&_a]:decoration-[#78bdf7]/60 [&_a]:decoration-[0.06em] [&_a]:underline-offset-[4px] hover:[&_a]:text-[#9dd2ff] [&_u]:decoration-[0.06em] [&_u]:underline-offset-[5px]",
                            "overflow-x-auto rounded-[6px] bg-card/80 px-3 py-2 pr-16 font-mono text-[13px] leading-6 text-foreground dark:bg-white/[0.04]",
                            block.showLineNumbers && "pl-11",
                          )}
                          data-placeholder="输入内容..."
                          html={block.text}
                        />
                      </div>
                    ) : (
                      <EditableBlock
                        refCallback={(el) => { blockRefs.current[i] = el }}
                        data-editor-block="true"
                        onFocus={() => { activeBlockRef.current = i; setActiveBlockIndex(i); clearBlockSelection() }}
                        onInput={(e) => handleBlockInput(i, e)}
                        onBlur={handleBlockBlur}
                        onKeyDown={(e) => handleBlockKeyDown(i, e)}
                        onPaste={(e) => handleBlockPaste(i, e)}
                        onClick={handleBlockClick}
                        editable={editingMode}
                        className={cn(
                          "min-h-7 min-w-0 max-w-full flex-1 whitespace-pre-wrap break-words text-left [overflow-wrap:anywhere] [word-break:break-word] decoration-[0.06em] underline-offset-[5px] outline-none [&_a]:cursor-pointer [&_a]:text-[#78bdf7] [&_a]:underline [&_a]:decoration-[#78bdf7]/60 [&_a]:decoration-[0.06em] [&_a]:underline-offset-[4px] hover:[&_a]:text-[#9dd2ff] [&_u]:decoration-[0.06em] [&_u]:underline-offset-[5px]",
                          isHeading && headingLevel === 1 && "text-[22px] font-semibold leading-8 text-foreground",
                          isHeading && headingLevel === 2 && "text-[19px] font-semibold leading-8 text-foreground",
                          isHeading && headingLevel >= 3 && "text-[17px] font-semibold leading-7 text-foreground",
                          isTodo && block.checked && "text-muted-foreground line-through",
                          isQuote && "border-l-2 border-border pl-3 italic text-muted-foreground",
                          isHighlight && "rounded-[6px] bg-[#fff2a8] px-3 py-1.5 text-[15px] leading-relaxed text-[#2d2a16] dark:bg-[#4a411e] dark:text-[#fff2b5]",
                          isColumns && "columns-2 gap-8 text-[15px] leading-relaxed text-foreground/90 [column-gap:2rem]",
                          isToggle && "min-h-7 overflow-hidden text-ellipsis whitespace-nowrap rounded-none bg-transparent px-0 py-0 text-[16px] leading-7 text-foreground",
                          !isHeading && !isTodo && !isQuote && !isCode && !isHighlight && !isColumns && !isToggle && "text-[15px] leading-relaxed text-foreground/90",
                        )}
                        data-placeholder="输入内容..."
                        html={block.text}
                      />
                    )}
                    {showInsertAfter && <BlockInsertIndicator position="after" />}
                  </div>
                )
              })}
            </div>
            <div
              aria-hidden="true"
              className={cn(
                "min-h-[24vh]",
                editingMode && "cursor-text",
              )}
            />
          </article>
        </div>

        {/* TOC 拖拽手柄 */}
        <div
          onMouseDown={tocOpen ? handleTocMouseDown : undefined}
          className={cn(
            "hidden w-1 shrink-0 xl:block",
            tocOpen && "cursor-col-resize transition-colors hover:bg-primary/20 active:bg-primary/30",
          )}
        />
        {/* 目录 TOC */}
        <aside
          style={{ width: tocWidth }}
          className={cn(
            "hidden min-h-0 shrink-0 overflow-hidden xl:flex",
            tocOpen ? "flex-col px-6 py-8" : "px-4 py-8",
          )}
        >
          {tocOpen ? (
            <>
              <div className="mb-5 flex shrink-0 items-center gap-3">
                <h3 className="text-base font-semibold text-foreground">大纲</h3>
                <ToolbarButton onClick={() => setTocOpen(false)} label="隐藏大纲">
                  <Eye className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  onClick={toggleAllTocHeadings}
                  active={allTocHeadingsCollapsed}
                  label={allTocHeadingsCollapsed ? "展开全部" : "收缩全部"}
                  disabled={collapsibleTocHeadingIndexes.length === 0}
                >
                  <List className="h-4 w-4" />
                </ToolbarButton>
              </div>
              <div className="toc-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
                <ul className="pb-24 pl-4">
                  {headings.length === 0 && (
                    <li className="text-xs text-muted-foreground">暂无目录</li>
                  )}
                  {visibleTocHeadings.map((heading, i) => {
                    const active = heading.index === activeTocHeadingIndex
                    return (
                      <li key={`${heading.index}-${i}`}>
                        <div
                          className={cn(
                            "flex items-center gap-1.5",
                            heading.level === 2 && "pl-6",
                            heading.level >= 3 && "pl-12",
                          )}
                        >
                          {heading.hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggleTocHeading(heading.index)}
                              aria-label={collapsedTocHeadingIds.has(heading.index) ? "展开子标题" : "收起子标题"}
                              title={collapsedTocHeadingIds.has(heading.index) ? "展开子标题" : "收起子标题"}
                              className={cn(
                                "flex h-5 w-4 shrink-0 items-center justify-center text-foreground/50 transition-colors hover:text-foreground",
                                active && "text-foreground",
                              )}
                            >
                              {collapsedTocHeadingIds.has(heading.index) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          ) : (
                            <span className="h-5 w-4 shrink-0" />
                          )}
                          <button
                            type="button"
                            onClick={() => handleTocClick(heading.index)}
                            className={cn(
                              "min-w-0 flex-1 truncate py-0.5 text-left text-[15px] leading-6 text-foreground/70 transition-colors hover:text-foreground",
                              heading.level <= 1 && "font-medium",
                              active && "font-semibold text-foreground",
                            )}
                          >
                            {stripHtml(heading.text)}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </>
          ) : (
            <div className="group relative flex h-full min-h-[280px] items-center">
              <button
                type="button"
                onClick={() => setTocOpen(true)}
                aria-label="显示大纲"
                title="显示大纲"
                className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
              >
                <Eye className="h-4 w-4" />
              </button>
              <div className="toc-scrollbar max-h-full w-full overflow-y-auto py-2">
                {tocHeadings.length === 0 ? (
                  <p className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">暂无目录</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {tocHeadings.map((heading, i) => {
                      const active = heading.index === activeTocHeadingIndex
                      return (
                        <li key={`${heading.index}-${i}`}>
                          <div
                            className={cn(
                              "flex w-full items-center gap-1 text-[15px] text-foreground/70 transition-colors hover:text-foreground",
                              active && "text-foreground",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1 shrink-0 rounded-full bg-foreground/30 transition-all group-hover:bg-foreground/45",
                                heading.level <= 1 && "w-5",
                                heading.level === 2 && "ml-3 w-4",
                                heading.level >= 3 && "ml-6 w-3",
                                active && "bg-foreground",
                              )}
                            />
                            <button
                              type="button"
                              onClick={() => handleTocClick(heading.index)}
                              className="min-w-0 flex-1 text-left"
                            >
                            <span
                              className={cn(
                                "block min-w-0 truncate opacity-0 transition-opacity group-hover:opacity-100",
                                heading.level <= 1 && "font-medium",
                                heading.level === 2 && "text-[13px]",
                                heading.level >= 3 && "text-xs",
                                active && "font-semibold text-foreground opacity-100",
                              )}
                            >
                              {stripHtml(heading.text)}
                            </span>
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <PromptDialog
        open={tagDialogOpen}
        onClose={() => setTagDialogOpen(false)}
        onSubmit={async (tag) => {
          if (!note || note.tags.includes(tag)) return
          try {
            await onUpdateNote(note.id, { tags: [...note.tags, tag] })
            toast(`已添加标签「${tag}」`, "success")
          } catch {
            toast("添加标签失败", "error")
          }
        }}
        title="添加标签"
        placeholder="输入标签名称"
        submitText="添加"
      />

      <PromptDialog
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        onSubmit={(url) => {
          const safeUrl = normalizeUrl(url, ["http:", "https:", "mailto:", "tel:"])
          if (!safeUrl) {
            toast("链接地址无效", "error")
            return
          }
          if (insertLink(safeUrl)) {
            toast("已插入链接", "success")
          } else {
            toast("请先选中正文内容", "error")
          }
        }}
        title="插入链接"
        placeholder="输入链接地址，例如 https://example.com"
        submitText="插入"
      />

      <Dialog
        open={imageDialogOpen}
        onClose={closeImageDialog}
        title="插入图片"
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleImageFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={imageUploadPending}
          className="mb-4 flex h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {imageUploadPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          <span>{imageUploadPending ? "正在上传" : "选择本地图片"}</span>
        </button>
        <div className="mb-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">或</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <input
          value={imageUrlDraft}
          onChange={(event) => {
            setImageUrlDraft(event.target.value)
            setImageDialogError("")
          }}
          onKeyDown={(event) => { if (event.key === "Enter") submitImageUrl() }}
          placeholder="输入图片地址，例如 https://example.com/image.png"
          disabled={imageUploadPending}
          className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        />
        {imageDialogError && (
          <p className="mb-3 text-xs text-destructive">{imageDialogError}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeImageDialog}
            disabled={imageUploadPending}
            className="rounded-lg border border-border px-3.5 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submitImageUrl}
            disabled={imageUploadPending || !imageUrlDraft.trim()}
            className="rounded-lg bg-primary px-3.5 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            插入
          </button>
        </div>
      </Dialog>
      <input
        ref={attachmentInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        onChange={handleAttachmentFileChange}
        className="hidden"
      />
    </section>
  )
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

function normalizeImageType(type: string): string {
  const normalized = type.trim().toLowerCase()
  return normalized === "image/jpg" ? "image/jpeg" : normalized
}

function isSupportedImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.has(normalizeImageType(file.type))
}

async function dedupeImageFiles(files: File[]): Promise<File[]> {
  const unique: File[] = []
  const seen = new Set<string>()

  for (const file of files) {
    const signature = await imageFileSignature(file)
    if (seen.has(signature)) continue
    seen.add(signature)
    unique.push(file)
  }

  return unique
}

async function imageFileSignature(file: File): Promise<string> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return `${normalizeImageType(file.type)}:${file.size}:${fnv1a(bytes)}`
  } catch {
    return `${file.name}:${normalizeImageType(file.type)}:${file.size}:${file.lastModified}`
  }
}

function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

function dataTransferHasSupportedImage(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.items).some((item) => (
    item.kind === "file" && SUPPORTED_IMAGE_TYPES.has(normalizeImageType(item.type))
  )) || Array.from(dataTransfer.files).some(isSupportedImageFile)
}

function getImageFilesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files: File[] = []
  const seen = new Set<string>()

  const addFile = (file: File | null) => {
    if (!file || !isSupportedImageFile(file)) return
    const key = `${file.name}:${normalizeImageType(file.type)}:${file.size}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }

  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind === "file") addFile(item.getAsFile())
  }
  for (const file of Array.from(dataTransfer.files)) {
    addFile(file)
  }

  return files
}

function getImageFilesFromHtml(html: string): File[] {
  if (!html || typeof DOMParser === "undefined") return []
  const doc = new DOMParser().parseFromString(html, "text/html")
  return Array.from(doc.images)
    .map((image, index) => dataUrlToImageFile(image.getAttribute("src") || "", `pasted-image-${index + 1}`))
    .filter((file): file is File => file !== null)
}

function clipboardHtmlHasImages(html: string): boolean {
  if (!html.trim()) return false
  if (typeof DOMParser === "undefined") return /<img\b/i.test(html)

  const doc = new DOMParser().parseFromString(html, "text/html")
  return Array.from(doc.images).some((image) => {
    const src = image.getAttribute("src") || ""
    return src.startsWith("data:") || !!normalizeImageBlockSrc(src)
  })
}

function buildPasteBlocksWithAssets(clipboardHtml: string, clipboardText: string, assets: Asset[]): NoteBlock[] {
  if (clipboardHtml.trim() && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(clipboardHtml, "text/html")
    doc.querySelectorAll("script, style, meta, link, iframe, object, embed").forEach((node) => node.remove())

    let assetIndex = 0
    for (const image of Array.from(doc.images)) {
      const asset = assets[assetIndex]
      if (asset) {
        image.src = asset.url
        image.alt = image.alt || asset.filename
        image.loading = "lazy"
        image.className = mergeImageClass(image.className)
        assetIndex += 1
        continue
      }

      const safeSrc = normalizeUrl(image.getAttribute("src") || "", ["http:", "https:"], {
        keepSameOriginRelative: true,
      })
      if (!safeSrc) {
        image.remove()
        continue
      }
      image.src = safeSrc
      image.loading = "lazy"
      image.className = mergeImageClass(image.className)
    }

    const blocks = htmlToImageAwareBlocks(doc.body)
    blocks.push(...assets.slice(assetIndex).map(assetToImageBlock))
    if (blocks.length) return blocks
  }

  const blocks: NoteBlock[] = []
  blocks.push(...plainTextToPasteBlocks(clipboardText))
  blocks.push(...assets.map(assetToImageBlock))
  return blocks
}

function plainTextToPasteBlocks(value: string): NoteBlock[] {
  const text = value.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim()
  if (!text) return []

  const fencedCodeMatch = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/)
  if (fencedCodeMatch) return [{ type: "code", text: escapeHtml(fencedCodeMatch[1]) }]

  return splitPlainTextBlocks(text).map(markdownTextToBlock)
}

function splitPlainTextBlocks(value: string): string[] {
  if (/\n\s*\n/.test(value)) {
    return value.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean)
  }

  const lines = value.split("\n").filter((line) => line.trim())
  return lines.length > 1 ? lines : [value]
}

function markdownTextToBlock(value: string): NoteBlock {
  const text = value.trim()
  const indent = markdownListIndent(value)
  const imageMatch = text.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/)
  if (imageMatch) {
    const src = normalizeImageBlockSrc(imageMatch[2])
    if (src) return imageToBlock(src, imageMatch[1])
  }

  const todoMatch = text.match(/^[-*+]\s+\[([ xX])\]\s+([\s\S]+)$/)
  if (todoMatch) {
    return listBlock("todo", plainTextBlockHtml(todoMatch[2]), {
      checked: todoMatch[1].toLowerCase() === "x",
      indent,
    })
  }

  const headingMatch = text.match(/^(#{1,3})\s+([\s\S]+)$/)
  if (headingMatch) {
    return {
      type: "heading",
      level: headingMatch[1].length as HeadingLevel,
      text: plainTextBlockHtml(headingMatch[2]),
    }
  }

  const bulletMatch = text.match(/^[-*+]\s+([\s\S]+)$/)
  if (bulletMatch) return listBlock("bullet", plainTextBlockHtml(bulletMatch[1]), { indent })

  const orderedMatch = text.match(/^\d+[.)]\s+([\s\S]+)$/)
  if (orderedMatch) return listBlock("ordered", plainTextBlockHtml(orderedMatch[1]), { indent })

  if (text.startsWith(">")) {
    return {
      type: "quote",
      text: plainTextBlockHtml(text.replace(/^>\s?/gm, "")),
    }
  }

  return { type: "paragraph", text: plainTextBlockHtml(text) }
}

function plainTextBlockHtml(value: string): string {
  return escapeHtml(value.trim()).replace(/\n/g, "<br>")
}

function clipboardHtmlHasBlockContent(html: string): boolean {
  if (!html.trim()) return false
  const blockSelector = Array.from(BLOCK_TAGS).join(",")
  if (typeof DOMParser === "undefined") return /<(address|article|aside|blockquote|div|figure|figcaption|h[1-6]|li|ol|p|pre|section|table|ul)\b/i.test(html)

  const doc = new DOMParser().parseFromString(html, "text/html")
  return Array.from(doc.body.querySelectorAll(blockSelector)).some((element) => (
    !!element.textContent?.trim() || !!element.querySelector("img")
  ))
}

function clipboardTextHasMultipleBlocks(text: string): boolean {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (!normalized) return false
  if (/\n\s*\n/.test(normalized)) return true
  return normalized.split("\n").filter((line) => line.trim()).length > 1
}

function htmlToImageAwareBlocks(root: ParentNode): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let currentHtml = ""

  const flush = () => {
    const html = currentHtml.trim()
    if (html && !isEmptyHtml(html)) blocks.push({ type: "paragraph", text: html })
    currentHtml = ""
  }

  const appendNode = (node: ChildNode) => {
    if (node.nodeType === Node.TEXT_NODE) {
      currentHtml += escapeHtml(node.textContent || "")
      return
    }

    if (!(node instanceof HTMLElement)) return

    const tagName = node.tagName.toLowerCase()
    if (tagName === "img") {
      flush()
      const imageHtml = normalizeImageElementHtml(node)
      if (imageHtml) blocks.push({ type: "paragraph", text: imageHtml })
      return
    }

    if (tagName === "br") {
      currentHtml += "<br>"
      return
    }

    if (tagName === "ul" || tagName === "ol") {
      flush()
      appendListNode(node, tagName === "ol" ? "ordered" : "bullet", 0)
      return
    }

    if (tagName === "li") {
      flush()
      appendListItem(node, "bullet", 0)
      return
    }

    const isBlock = BLOCK_TAGS.has(tagName)
    if (isBlock) flush()

    const inlineTag = INLINE_TAGS.has(tagName) ? inlineTagPair(node, tagName) : null
    if (inlineTag) {
      currentHtml += inlineTag.open
      node.childNodes.forEach(appendNode)
      currentHtml += inlineTag.close
    } else {
      node.childNodes.forEach(appendNode)
    }

    if (isBlock) flush()
  }

  const inlineNodeHtml = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "")
    if (!(node instanceof HTMLElement)) return ""

    const tagName = node.tagName.toLowerCase()
    if (tagName === "ul" || tagName === "ol") return ""
    if (tagName === "img") return normalizeImageElementHtml(node) ?? ""
    if (tagName === "br") return "<br>"

    const childHtml = Array.from(node.childNodes).map(inlineNodeHtml).join("")
    const inlineTag = INLINE_TAGS.has(tagName) ? inlineTagPair(node, tagName) : null
    if (inlineTag) return `${inlineTag.open}${childHtml}${inlineTag.close}`
    return childHtml
  }

  const appendListItem = (item: HTMLElement, type: ListBlockType, indent: number) => {
    const text = Array.from(item.childNodes).map(inlineNodeHtml).join("").trim()
    blocks.push(listBlock(type, text, { indent }))

    Array.from(item.children).forEach((child) => {
      const tagName = child.tagName.toLowerCase()
      if (tagName !== "ul" && tagName !== "ol") return
      appendListNode(child as HTMLElement, tagName === "ol" ? "ordered" : "bullet", indent + 1)
    })
  }

  const appendListNode = (list: HTMLElement, type: ListBlockType, indent: number) => {
    Array.from(list.children).forEach((child) => {
      if (child.tagName.toLowerCase() === "li") {
        appendListItem(child as HTMLElement, type, indent)
      } else {
        appendNode(child)
      }
    })
  }

  root.childNodes.forEach(appendNode)
  flush()
  return blocks
}

function assetToImageBlock(asset: Asset): NoteBlock {
  return imageToBlock(asset.url, asset.filename)
}

function imageToBlock(src: string, alt: string): NoteBlock {
  return { type: "paragraph", text: imageHtml(src, alt) }
}

function imageHtml(src: string, alt: string): string {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" class="max-w-full rounded-[8px]">`
}

function normalizeImageElementHtml(image: HTMLElement): string | null {
  const src = normalizeUrl(image.getAttribute("src") || "", ["http:", "https:"], { keepSameOriginRelative: true })
  if (!src) return null
  return imageHtml(src, image.getAttribute("alt") || "")
}

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "div", "figure", "figcaption", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "main", "nav", "ol", "p",
  "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
])

const INLINE_TAGS = new Set(["a", "b", "code", "em", "i", "kbd", "mark", "s", "span", "strong", "sub", "sup", "u"])

function inlineTagPair(element: HTMLElement, tagName: string): { open: string; close: string } | null {
  if (tagName === "a") {
    const href = normalizeUrl(element.getAttribute("href") || "", ["http:", "https:", "mailto:", "tel:"], {
      keepSameOriginRelative: true,
    })
    if (!href) return null
    const target = href.startsWith("http://") || href.startsWith("https://") ? ' target="_blank"' : ""
    return { open: `<a href="${escapeHtml(href)}"${target} rel="noopener noreferrer">`, close: "</a>" }
  }
  if (tagName === "span" && element.className) {
    return { open: `<span class="${escapeHtml(element.className)}">`, close: "</span>" }
  }
  return { open: `<${tagName}>`, close: `</${tagName}>` }
}

function mergeImageClass(value: string): string {
  const classes = new Set(value.split(/\s+/).filter(Boolean))
  classes.add("max-w-full")
  classes.delete("rounded-lg")
  classes.add("rounded-[8px]")
  return Array.from(classes).join(" ")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function dataUrlToImageFile(dataUrl: string, name: string): File | null {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i)
  if (!match) return null

  const contentType = normalizeImageType(match[1])
  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) return null

  try {
    const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3])
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) {
      bytes[i] = raw.charCodeAt(i)
    }
    const extension = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1]
    return new File([bytes], `${name}.${extension}`, { type: contentType })
  } catch {
    return null
  }
}

function isListType(type: NoteBlock["type"]): type is ListBlockType {
  return type === "bullet" || type === "ordered" || type === "todo"
}

function isListBlock(block: NoteBlock | undefined): block is NoteBlock & { type: ListBlockType } {
  return !!block && isListType(block.type)
}

function getBlockIndent(block: NoteBlock | undefined): number {
  if (!block || typeof block.indent !== "number" || !Number.isFinite(block.indent)) return 0
  return Math.max(0, Math.min(MAX_LIST_INDENT, Math.trunc(block.indent)))
}

function withListIndent<T extends NoteBlock>(block: T, indent: number): T {
  const nextIndent = Math.max(0, Math.min(MAX_LIST_INDENT, Math.trunc(indent)))
  if (nextIndent <= 0) {
    const { indent: _indent, ...rest } = block
    return rest as T
  }
  return { ...block, indent: nextIndent }
}

function listBlock(
  type: ListBlockType,
  text: string,
  options: { indent?: number; toggleParentId?: string; checked?: boolean } = {},
): NoteBlock {
  const block: NoteBlock = {
    type,
    text,
    ...(options.toggleParentId ? { toggleParentId: options.toggleParentId } : {}),
  }
  if (type === "todo") block.checked = options.checked ?? false
  return withListIndent(block, options.indent ?? 0)
}

function listContinuationBlock(block: NoteBlock & { type: ListBlockType }, text: string): NoteBlock {
  return listBlock(block.type, text, {
    indent: getBlockIndent(block),
    toggleParentId: block.toggleParentId,
    checked: block.type === "todo" ? false : undefined,
  })
}

function toTypedBlock(
  block: NoteBlock,
  type: NoteBlock["type"],
  text = block.text,
  options: { level?: HeadingLevel } = {},
): NoteBlock {
  if (type === "toggle") return toToggleBlock({ ...block, text }, block.toggleId ?? makeToggleId())

  const {
    level: _level,
    checked: _checked,
    collapsed: _collapsed,
    showLineNumbers: _showLineNumbers,
    toggleId: _toggleId,
    indent: _indent,
    ...rest
  } = block

  if (type === "heading") return { ...rest, type, text, level: options.level ?? 1 }
  if (type === "todo") return listBlock("todo", text, {
    indent: getBlockIndent(block),
    toggleParentId: block.toggleParentId,
    checked: block.checked ?? false,
  })
  if (type === "bullet" || type === "ordered") {
    return listBlock(type, text, {
      indent: getBlockIndent(block),
      toggleParentId: block.toggleParentId,
    })
  }
  if (type === "code") return { ...rest, type, text, showLineNumbers: block.showLineNumbers ?? false }
  return { ...rest, type, text }
}

function markdownListIndent(value: string): number {
  const match = value.match(/^[\t ]*/)
  const width = (match?.[0] ?? "").replace(/\t/g, "  ").length
  return Math.max(0, Math.min(MAX_LIST_INDENT, Math.floor(width / 2)))
}

function getOrderedListNumber(blocks: NoteBlock[], index: number): number {
  const block = blocks[index]
  if (block?.type !== "ordered") return 0

  const indent = getBlockIndent(block)
  let count = 0
  for (let i = index; i >= 0; i -= 1) {
    const current = blocks[i]
    if (!isListBlock(current)) break

    const currentIndent = getBlockIndent(current)
    if (currentIndent < indent) break
    if (currentIndent > indent) continue
    if (current.type !== "ordered") break
    count += 1
  }
  return Math.max(1, count)
}

function fragmentToHtml(fragment: DocumentFragment): string {
  const container = document.createElement("div")
  container.appendChild(fragment.cloneNode(true))
  return container.innerHTML
}

function splitEditableBlockAtSelection(el: HTMLDivElement): { beforeHtml: string; afterHtml: string; atStart: boolean } {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return { beforeHtml: el.innerHTML, afterHtml: "", atStart: false }
  }

  const range = selection.getRangeAt(0)
  if (!el.contains(range.commonAncestorContainer)) {
    return { beforeHtml: el.innerHTML, afterHtml: "", atStart: false }
  }

  const beforeRange = document.createRange()
  beforeRange.setStart(el, 0)
  beforeRange.setEnd(range.startContainer, range.startOffset)

  const afterRange = document.createRange()
  afterRange.setStart(range.endContainer, range.endOffset)
  afterRange.setEnd(el, el.childNodes.length)

  const beforeHtml = fragmentToHtml(beforeRange.cloneContents())
  const afterHtml = fragmentToHtml(afterRange.cloneContents())
  return {
    beforeHtml,
    afterHtml,
    atStart: isEmptyHtml(beforeHtml),
  }
}

function placeCaretAtPoint(clientX: number, clientY: number, fallbackBlock: HTMLDivElement): boolean {
  fallbackBlock.focus()

  const doc = fallbackBlock.ownerDocument
  const selection = doc.getSelection()
  if (!selection) return false

  const docWithCaretPosition = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  const docWithCaretRange = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }

  let range: Range | null = null
  const caretPosition = docWithCaretPosition.caretPositionFromPoint?.(clientX, clientY)
  if (caretPosition) {
    range = doc.createRange()
    range.setStart(caretPosition.offsetNode, caretPosition.offset)
    range.collapse(true)
  } else {
    range = docWithCaretRange.caretRangeFromPoint?.(clientX, clientY) ?? null
  }

  if (!range || !fallbackBlock.contains(range.commonAncestorContainer)) {
    range = doc.createRange()
    range.selectNodeContents(fallbackBlock)
    range.collapse(false)
  }

  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

function normalizeUrl(
  value: string,
  allowedProtocols: string[],
  options: { keepSameOriginRelative?: boolean } = {},
): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed, window.location.origin)
    if (!allowedProtocols.includes(url.protocol)) return null
    if (options.keepSameOriginRelative && url.origin === window.location.origin && trimmed.startsWith("/")) {
      return `${url.pathname}${url.search}${url.hash}`
    }
    return url.href
  } catch {
    return null
  }
}

function getImageBlockData(value: string): ImageBlockData | null {
  const html = value.trim()
  if (!html) return null

  if (typeof DOMParser !== "undefined" && typeof Node !== "undefined" && typeof Element !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html")
    const meaningfulNodes = Array.from(doc.body.childNodes).filter((node) => {
      if (node.nodeType === Node.TEXT_NODE) return !!node.textContent?.trim()
      return node.nodeType === Node.ELEMENT_NODE
    })

    if (meaningfulNodes.length !== 1) return null
    const element = meaningfulNodes[0]
    if (!(element instanceof Element) || element.tagName.toLowerCase() !== "img") return null

    const src = normalizeImageBlockSrc(element.getAttribute("src") || "")
    if (!src) return null
    return {
      src,
      alt: element.getAttribute("alt") || "",
    }
  }

  const match = html.match(/^<img\b([^>]*)\/?>$/i)
  if (!match) return null

  const src = normalizeImageBlockSrc(htmlAttribute(match[1], "src"))
  if (!src) return null
  return {
    src,
    alt: decodeHtmlEntities(htmlAttribute(match[1], "alt")),
  }
}

function normalizeImageBlockSrc(value: string): string | null {
  const src = decodeHtmlEntities(value).trim()
  if (!src || /[\u0000-\u001f\u007f<>"']/u.test(src)) return null
  if (src.startsWith("/") && !src.startsWith("//")) return src

  try {
    const url = new URL(src)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

function htmlAttribute(attrs: string, name: string): string {
  const attrPattern = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g
  for (const attr of attrs.matchAll(attrPattern)) {
    if (attr[1].toLowerCase() === name) return attr[2] ?? attr[3] ?? attr[4] ?? ""
  }
  return ""
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function stripHtml(value: string): string {
  if (!value) return ""
  const div = typeof document === "undefined" ? null : document.createElement("div")
  if (!div) return value.replace(/<[^>]*>/g, "")
  div.innerHTML = value
  return div.textContent ?? ""
}

function isEmptyHtml(value: string): boolean {
  return !stripHtml(value).replace(/\u00a0/g, " ").trim()
}

function getTocLevel(value: string): number {
  const text = stripHtml(value).trim()
  const match = text.match(/^(\d+(?:\.\d+)*)/)
  if (!match) return 1
  return Math.min(3, match[1].split(".").length)
}

function getHeadingLevel(block: NoteBlock): HeadingLevel {
  if (block.level === 1) return 1
  if (block.level === 2 || block.level === 3) return block.level
  return getTocLevel(block.text) as HeadingLevel
}

function getTocHeadings(headings: Array<Omit<TocHeading, "hasChildren">>): TocHeading[] {
  return headings.map((heading, index) => {
    let hasChildren = false
    for (let i = index + 1; i < headings.length; i += 1) {
      if (headings[i].level <= heading.level) break
      hasChildren = true
      break
    }
    return { ...heading, hasChildren }
  })
}

function getVisibleTocHeadings(headings: TocHeading[], collapsedIds: Set<number>): TocHeading[] {
  const visible: TocHeading[] = []
  const collapsedLevels: HeadingLevel[] = []

  for (const heading of headings) {
    while (collapsedLevels.length > 0 && collapsedLevels[collapsedLevels.length - 1] >= heading.level) {
      collapsedLevels.pop()
    }

    if (collapsedLevels.length === 0) {
      visible.push(heading)
    }

    if (heading.hasChildren && collapsedIds.has(heading.index)) {
      collapsedLevels.push(heading.level)
    }
  }

  return visible
}

function makeToggleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `toggle-${crypto.randomUUID()}`
  return `toggle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function toToggleBlock(block: NoteBlock, toggleId: string): NoteBlock {
  const {
    checked: _checked,
    level: _level,
    indent: _indent,
    showLineNumbers: _showLineNumbers,
    toggleParentId: _toggleParentId,
    ...rest
  } = block
  return { ...rest, type: "toggle", collapsed: block.collapsed ?? false, toggleId }
}

function getToggleChildEnd(blocks: NoteBlock[], toggleIndex: number): number {
  const toggle = blocks[toggleIndex]
  if (toggle?.type !== "toggle") return toggleIndex + 1

  if (toggle.toggleId) {
    let end = toggleIndex + 1
    while (end < blocks.length && blocks[end].toggleParentId === toggle.toggleId) {
      end += 1
    }
    return end
  }

  let end = toggleIndex + 1
  while (end < blocks.length && blocks[end].type !== "toggle") {
    end += 1
  }
  return end
}

function getCollapsedBlockIndexes(blocks: NoteBlock[]): Set<number> {
  const hidden = new Set<number>()

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.type !== "toggle" || !block.collapsed) continue
    const end = getToggleChildEnd(blocks, i)
    for (let childIndex = i + 1; childIndex < end; childIndex += 1) hidden.add(childIndex)
  }

  return hidden
}

interface ToggleChildLayout {
  ownerIndex: number
  isFirst: boolean
  isLast: boolean
}

function getToggleChildLayouts(blocks: NoteBlock[]): Map<number, ToggleChildLayout> {
  const layouts = new Map<number, ToggleChildLayout>()

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.type !== "toggle" || block.collapsed) continue

    const end = getToggleChildEnd(blocks, i)
    for (let childIndex = i + 1; childIndex < end; childIndex += 1) {
      layouts.set(childIndex, {
        ownerIndex: i,
        isFirst: childIndex === i + 1,
        isLast: childIndex === end - 1,
      })
    }
  }
  return layouts
}

function getToggleBodyCounts(blocks: NoteBlock[]): Map<number, number> {
  const counts = new Map<number, number>()

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.type !== "toggle") continue
    counts.set(i, Math.max(0, getToggleChildEnd(blocks, i) - i - 1))
  }

  return counts
}

function codeBlockText(value: string): string {
  const withLineBreaks = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>\s*<div[^>]*>/gi, "\n")
    .replace(/^<div[^>]*>/i, "")
    .replace(/<\/div>$/i, "")
    .replace(/<div[^>]*>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/^<p[^>]*>/i, "")
    .replace(/<\/p>$/i, "")
  return decodeHtmlEntities(stripHtml(withLineBreaks)).replace(/\u00a0/g, " ")
}

function getCodeLineCount(value: string): number {
  return Math.max(1, codeBlockText(value).split("\n").length)
}

function blockToClipboardText(block: NoteBlock, orderedNumber: number): string {
  const text = stripHtml(block.text).replace(/\u00a0/g, " ").trimEnd()
  const indent = "  ".repeat(getBlockIndent(block))

  if (block.type === "bullet") return text ? `${indent}- ${text}` : `${indent}-`
  if (block.type === "ordered") return text ? `${indent}${orderedNumber}. ${text}` : `${indent}${orderedNumber}.`
  if (block.type === "todo") return `${indent}- [${block.checked ? "x" : " "}] ${text}`.trimEnd()
  if (block.type === "quote") return text ? `> ${text}` : ">"
  if (block.type === "code") return codeBlockText(block.text)

  return text
}

function blockToClipboardHtml(block: NoteBlock, orderedNumber: number): string {
  const html = block.text || "<br>"

  if (block.type === "heading") {
    const level = getHeadingLevel(block)
    return `<h${level}>${html}</h${level}>`
  }

  const indentStyle = getBlockIndent(block) > 0 ? ` style="margin-left: ${getBlockIndent(block) * 1.5}em"` : ""
  if (block.type === "bullet") return `<ul${indentStyle}><li>${html}</li></ul>`
  if (block.type === "ordered") return `<ol start="${orderedNumber}"${indentStyle}><li>${html}</li></ol>`
  if (block.type === "todo") return `<p>${block.checked ? "☑" : "☐"} ${html}</p>`
  if (block.type === "quote") return `<blockquote>${html}</blockquote>`
  if (block.type === "code") return `<pre><code>${html}</code></pre>`
  if (block.type === "highlight") return `<div><mark>${html}</mark></div>`
  if (block.type === "columns") return `<div>${html}</div>`
  if (block.type === "toggle") return `<details${block.collapsed ? "" : " open"}><summary>${html}</summary></details>`

  return `<p>${html}</p>`
}

function copyBlocksWithSelectionFallback(plainText: string, html: string): boolean {
  if (typeof document === "undefined") return false

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = window.getSelection()
  const previousRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : []

  const container = document.createElement(html ? "div" : "textarea")
  container.setAttribute("aria-hidden", "true")
  container.style.position = "fixed"
  container.style.left = "-9999px"
  container.style.top = "0"
  container.style.opacity = "0"

  if (container instanceof HTMLTextAreaElement) {
    container.value = plainText
    document.body.appendChild(container)
    container.focus()
    container.select()
  } else {
    container.contentEditable = "true"
    container.innerHTML = html || escapeHtml(plainText).replace(/\r?\n/g, "<br>")
    document.body.appendChild(container)
    const range = document.createRange()
    range.selectNodeContents(container)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }

  container.remove()
  selection?.removeAllRanges()
  for (const range of previousRanges) selection?.addRange(range)
  active?.focus()
  return ok
}

function ImageBlock({
  refCallback,
  image,
  editingMode,
  onInsertAfter,
}: {
  refCallback: (el: HTMLDivElement | null) => void
  image: ImageBlockData
  editingMode: boolean
  onInsertAfter: () => void
}) {
  return (
    <div
      ref={refCallback}
      data-editor-block="true"
      tabIndex={-1}
      onMouseDown={(event) => {
        if (!editingMode || event.button !== 0) return
        const target = event.target
        if (target instanceof Element && target.closest('[data-image-frame="true"]')) return
        event.preventDefault()
        event.stopPropagation()
        onInsertAfter()
      }}
      onKeyDown={(event) => {
        if (!editingMode || event.key !== "Enter") return
        event.preventDefault()
        onInsertAfter()
      }}
      className="group/image relative flex min-w-0 flex-1 justify-center outline-none"
    >
      <div
        data-image-frame="true"
        className="relative block max-w-full overflow-hidden rounded-[8px] border border-transparent bg-transparent transition-[border-color] duration-150 ease-out group-hover/image:border-black/[0.08] dark:group-hover/image:border-white/[0.12]"
      >
        <img
          src={image.src}
          alt={image.alt}
          className="max-h-[70vh] max-w-full rounded-[8px] object-contain opacity-100 transition-opacity duration-150 ease-out group-hover/image:opacity-[0.92]"
        />
        <span className="pointer-events-none absolute inset-0 rounded-[8px] bg-black/0 transition-colors duration-150 ease-out group-hover/image:bg-black/[0.035] dark:group-hover/image:bg-white/[0.04]" />
      </div>
      {editingMode && (
        <button
          type="button"
          data-editor-control="true"
          tabIndex={-1}
          aria-label="在图片下方新建块"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onInsertAfter()
          }}
          className="absolute -bottom-8 left-0 right-0 z-20 h-8 cursor-text rounded-[6px] outline-none"
        />
      )}
    </div>
  )
}

function BlockActionMenu({
  menuRef,
  block,
  transformOpen,
  onTransformOpenChange,
  onTransform,
  onDelete,
  onCopy,
  onCut,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>
  block: NoteBlock
  transformOpen: boolean
  onTransformOpenChange: (open: boolean) => void
  onTransform: (type: NoteBlock["type"], level?: HeadingLevel) => void
  onDelete: () => void
  onCopy: () => void
  onCut: () => void
}) {
  const headingLevel = block.type === "heading" ? getHeadingLevel(block) : null
  const transformCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTransformCloseTimer = useCallback(() => {
    if (!transformCloseTimerRef.current) return
    clearTimeout(transformCloseTimerRef.current)
    transformCloseTimerRef.current = null
  }, [])

  const openTransformMenu = useCallback(() => {
    clearTransformCloseTimer()
    onTransformOpenChange(true)
  }, [clearTransformCloseTimer, onTransformOpenChange])

  const closeTransformMenu = useCallback(() => {
    clearTransformCloseTimer()
    onTransformOpenChange(false)
  }, [clearTransformCloseTimer, onTransformOpenChange])

  const scheduleTransformClose = useCallback(() => {
    clearTransformCloseTimer()
    transformCloseTimerRef.current = setTimeout(() => {
      transformCloseTimerRef.current = null
      onTransformOpenChange(false)
    }, 180)
  }, [clearTransformCloseTimer, onTransformOpenChange])

  useEffect(() => clearTransformCloseTimer, [clearTransformCloseTimer])

  return (
    <div
      ref={menuRef}
      data-editor-control="true"
      role="menu"
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      className="absolute -left-7 top-8 z-50 w-32 origin-top-left rounded-[8px] border border-border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg shadow-black/20 animate-in fade-in-0 zoom-in-95 slide-in-from-left-1 duration-150"
    >
      <div
        className="relative"
        onMouseEnter={openTransformMenu}
        onMouseLeave={scheduleTransformClose}
        onFocusCapture={openTransformMenu}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            closeTransformMenu()
          }
        }}
      >
        <BlockMenuButton
          icon={<Type className="h-4 w-4" />}
          label="转化为"
          trailing={<ChevronRight className="h-4 w-4 text-muted-foreground" />}
          onClick={openTransformMenu}
        />
        {transformOpen && (
          <>
            <span
              aria-hidden="true"
              onMouseEnter={openTransformMenu}
              className="absolute left-full top-1/2 z-40 h-44 w-3 -translate-y-1/2"
            />
            <div
              role="menu"
              onMouseEnter={openTransformMenu}
              onMouseLeave={scheduleTransformClose}
              className="absolute left-[calc(100%+12px)] top-1/2 z-50 w-44 origin-left -translate-y-1/2 rounded-[8px] border border-border bg-popover p-1.5 text-[13px] text-popover-foreground shadow-lg shadow-black/20 animate-in fade-in-0 zoom-in-95 slide-in-from-left-2 duration-150"
            >
              <div className="grid grid-cols-4 gap-1">
                <BlockTransformIconButton
                  active={headingLevel === 1}
                  label="标题 1"
                  onClick={() => onTransform("heading", 1)}
                >
                  <Heading1 className="h-4 w-4" />
                </BlockTransformIconButton>
                <BlockTransformIconButton
                  active={headingLevel === 2}
                  label="标题 2"
                  onClick={() => onTransform("heading", 2)}
                >
                  <Heading2 className="h-4 w-4" />
                </BlockTransformIconButton>
                <BlockTransformIconButton
                  active={headingLevel === 3}
                  label="标题 3"
                  onClick={() => onTransform("heading", 3)}
                >
                  <Heading3 className="h-4 w-4" />
                </BlockTransformIconButton>
                <BlockTransformIconButton
                  active={block.type === "paragraph"}
                  label="文本"
                  onClick={() => onTransform("paragraph")}
                >
                  <Type className="h-4 w-4" />
                </BlockTransformIconButton>
                <BlockTransformIconButton
                  active={block.type === "bullet"}
                  label="无序列表"
                  onClick={() => onTransform("bullet")}
                >
                  <List className="h-4 w-4" />
                </BlockTransformIconButton>
                <BlockTransformIconButton
                  active={block.type === "ordered"}
                  label="有序列表"
                  onClick={() => onTransform("ordered")}
                >
                  <ListOrdered className="h-4 w-4" />
                </BlockTransformIconButton>
                <BlockTransformIconButton
                  active={block.type === "todo"}
                  label="待办"
                  onClick={() => onTransform("todo")}
                >
                  <ListChecks className="h-4 w-4" />
                </BlockTransformIconButton>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1">
                <BlockTransformTextButton
                  active={block.type === "highlight"}
                  icon={<Highlighter className="h-3.5 w-3.5" />}
                  label="高亮块"
                  onClick={() => onTransform("highlight")}
                />
                <BlockTransformTextButton
                  active={block.type === "quote"}
                  icon={<Quote className="h-3.5 w-3.5" />}
                  label="引用"
                  onClick={() => onTransform("quote")}
                />
                <BlockTransformTextButton
                  active={block.type === "columns"}
                  icon={<Columns2 className="h-3.5 w-3.5" />}
                  label="分栏"
                  onClick={() => onTransform("columns")}
                />
                <BlockTransformTextButton
                  active={block.type === "toggle"}
                  icon={<ListCollapse className="h-3.5 w-3.5" />}
                  label="折叠块"
                  onClick={() => onTransform("toggle")}
                />
                <BlockTransformTextButton
                  active={block.type === "code"}
                  icon={<Code2 className="h-3.5 w-3.5" />}
                  label="代码块"
                  onClick={() => onTransform("code")}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="my-1 h-px bg-border" />
      <BlockMenuButton
        destructive
        icon={<Trash2 className="h-4 w-4" />}
        label="删除"
        onClick={onDelete}
      />
      <BlockMenuButton
        icon={<Copy className="h-4 w-4" />}
        label="复制"
        onClick={onCopy}
      />
      <BlockMenuButton
        icon={<Scissors className="h-4 w-4" />}
        label="剪切"
        onClick={onCut}
      />
    </div>
  )
}

function BlockMenuButton({
  icon,
  label,
  trailing,
  destructive = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  trailing?: React.ReactNode
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-popover-foreground hover:bg-accent",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}

function BlockTransformIconButton({
  active,
  label,
  children,
  onClick,
}: {
  active: boolean
  label: string
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex h-7 items-center justify-center rounded-[5px] text-popover-foreground transition-colors hover:bg-accent",
        active && "bg-accent text-popover-foreground",
      )}
    >
      {children}
    </button>
  )
}

function BlockTransformTextButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 text-left text-popover-foreground transition-colors hover:bg-accent",
        active && "bg-accent text-popover-foreground",
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

function CodeBlockToolButton({
  active = false,
  label,
  children,
  onClick,
}: {
  active?: boolean
  label: string
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-[5px] bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:bg-background/70",
        active && "bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary",
      )}
    >
      {children}
    </button>
  )
}

function ToolbarButton({ children, onClick, active, label, disabled, activeStyle = "fill" }: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  label?: string
  disabled?: boolean
  activeStyle?: "fill" | "strong"
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
        active && activeStyle === "fill" && "bg-primary/15 text-primary",
        active && activeStyle === "strong" && "text-foreground [&_svg]:stroke-[2.5]",
        !active && "text-muted-foreground hover:bg-accent hover:text-foreground",
        active && activeStyle === "strong" && "hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}

function BlockInsertIndicator({ position = "before" }: { position?: "before" | "after" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-0 right-0 z-10",
        position === "before" ? "-top-1.5" : "-bottom-1.5",
      )}
    >
      <span className="block h-[4px] w-full rounded-full bg-[#dbe0e5] dark:bg-[#a3abb5]" />
    </div>
  )
}

function EditableBlock({
  html,
  refCallback,
  className,
  onFocus,
  onInput,
  onBlur,
  onKeyDown,
  onPaste,
  onPointerDown,
  onClick,
  editable,
}: {
  html: string
  refCallback: (el: HTMLDivElement | null) => void
  className?: string
  onFocus: () => void
  onInput: (e: React.FormEvent<HTMLDivElement>) => void
  onBlur: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
  editable: boolean
}) {
  const localRef = useRef<HTMLDivElement | null>(null)

  const setRef = useCallback((el: HTMLDivElement | null) => {
    localRef.current = el
    refCallback(el)
  }, [refCallback])

  useEffect(() => {
    const el = localRef.current
    if (!el || document.activeElement === el || el.innerHTML === html) return
    el.innerHTML = html
  }, [html])

  return (
    <div
      ref={setRef}
      data-editor-block="true"
      contentEditable={editable}
      suppressContentEditableWarning
      onFocus={onFocus}
      onInput={onInput}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={className}
      data-placeholder="输入内容..."
    />
  )
}
