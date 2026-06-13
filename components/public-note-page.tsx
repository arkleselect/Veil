"use client"

import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Copy, Loader2, Star } from "lucide-react"
import type { Note, NoteBlock } from "@/lib/notes-data"
import { DEFAULT_NOTEBOOK_ICON, DEFAULT_NOTEBOOK_NAME } from "@/lib/notes-data"
import { createNote, updateNote } from "@/lib/api"
import { copyText } from "@/lib/share"
import { cn } from "@/lib/utils"
import { useToast } from "@/components/toast-provider"

interface PublicShareResponse {
  note: Note
  markdown: string
}

export function PublicNotePage({ token }: { token: string }) {
  const { toast } = useToast()
  const [data, setData] = useState<PublicShareResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [favoritePending, setFavoritePending] = useState(false)
  const [copyPending, setCopyPending] = useState(false)
  const [favorited, setFavorited] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/share/${encodeURIComponent(token)}`, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "分享内容不存在")
        return response.json() as Promise<PublicShareResponse>
      })
      .then((nextData) => {
        if (!cancelled) setData(nextData)
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : "分享内容加载失败", "error")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [toast, token])

  const handleCopyMarkdown = useCallback(async () => {
    if (!data || copyPending) return
    setCopyPending(true)
    try {
      await copyText(data.markdown)
      toast("已复制 Markdown", "success")
    } catch {
      toast("复制失败", "error")
    } finally {
      setCopyPending(false)
    }
  }, [copyPending, data, toast])

  const handleFavorite = useCallback(async () => {
    if (!data || favoritePending || favorited) return
    setFavoritePending(true)
    try {
      const auth = await fetch("/api/auth/me", { credentials: "same-origin" })
      if (auth.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
        return
      }
      if (!auth.ok) throw new Error("登录状态检查失败")

      const created = await createNote({
        title: data.note.title,
        notebook: DEFAULT_NOTEBOOK_NAME,
        notebookIcon: DEFAULT_NOTEBOOK_ICON,
        tags: data.note.tags,
        blocks: data.note.blocks,
      })
      await updateNote(created.id, { starred: true, baseVersion: created.version })
      setFavorited(true)
      toast("已收藏到我的笔记", "success")
    } catch (error) {
      toast(error instanceof Error ? error.message : "收藏失败", "error")
    } finally {
      setFavoritePending(false)
    }
  }, [data, favoritePending, favorited, toast])

  const title = data?.note.title || "分享笔记"

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-background/92 px-4 backdrop-blur">
        <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleFavorite}
            disabled={!data || favoritePending || favorited}
            className="flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            {favoritePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className={cn("h-4 w-4", favorited && "fill-primary text-primary")} />}
            <span>{favorited ? "已收藏" : "收藏"}</span>
          </button>
          <button
            type="button"
            onClick={handleCopyMarkdown}
            disabled={!data || copyPending}
            className="flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            {copyPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            <span>复制 Markdown</span>
          </button>
        </div>
      </header>

      <article className="mx-auto w-[calc(100%-3rem)] max-w-2xl py-10">
        {loading && <p className="text-sm text-muted-foreground">加载中...</p>}
        {!loading && !data && <p className="text-sm text-muted-foreground">分享内容不存在或链接已失效。</p>}
        {data && (
          <>
            <h2 className="break-words text-3xl font-semibold tracking-tight">{data.note.title}</h2>
            <div className="mt-8 flex flex-col gap-3">
              {renderPublicBlocks(data.note.blocks)}
            </div>
          </>
        )}
      </article>
    </main>
  )
}

function renderPublicBlocks(blocks: NoteBlock[]) {
  const items: ReactNode[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.type !== "toggle") {
      items.push(renderPublicBlock(block, `block-${index}`, index))
      continue
    }

    const children: NoteBlock[] = []
    let childIndex = index + 1
    while (childIndex < blocks.length && blocks[childIndex].type !== "toggle") {
      children.push(blocks[childIndex])
      childIndex += 1
    }
    index = childIndex - 1

    items.push(
      <details
        key={`toggle-${index}`}
        open={!block.collapsed}
        className="rounded-[8px] bg-card/80 px-3 py-2 dark:bg-white/[0.04]"
      >
        <summary className="cursor-pointer list-none text-[16px] leading-7 [&::-webkit-details-marker]:hidden">
          <span dangerouslySetInnerHTML={{ __html: block.text || "折叠块" }} />
        </summary>
        {children.length > 0 && (
          <div className="mt-3 flex flex-col gap-3 pl-6">
            {children.map((child, childOffset) => renderPublicBlock(child, `toggle-${index}-${childOffset}`, childOffset))}
          </div>
        )}
      </details>,
    )
  }

  return items
}

function renderPublicBlock(block: NoteBlock, key: string, index: number) {
  const html = block.text || "<br>"
  if (block.type === "heading") {
    const level = block.level === 2 || block.level === 3 ? block.level : 1
    const Tag = `h${level}` as "h1" | "h2" | "h3"
    return (
      <Tag
        key={key}
        className={cn(
          "break-words font-semibold text-foreground",
          level === 1 && "text-[22px] leading-8",
          level === 2 && "text-[19px] leading-8",
          level === 3 && "text-[17px] leading-7",
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  if (block.type === "bullet") {
    return (
      <div key={key} className="flex gap-2 text-[15px] leading-relaxed text-foreground/90">
        <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
        <span className="min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }

  if (block.type === "ordered") {
    return (
      <div key={key} className="flex gap-2 text-[15px] leading-relaxed text-foreground/90">
        <span className="min-w-[1.4em] shrink-0 text-right text-xs leading-7 text-muted-foreground">{index + 1}.</span>
        <span className="min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }

  if (block.type === "todo") {
    return (
      <div key={key} className={cn("flex gap-2 text-[15px] leading-relaxed text-foreground/90", block.checked && "text-muted-foreground line-through")}>
        <span className={cn("mt-[6px] flex h-4 w-4 shrink-0 items-center justify-center rounded border", block.checked ? "border-primary bg-primary" : "border-border")} />
        <span className="min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }

  if (block.type === "quote") {
    return <blockquote key={key} className="border-l-2 border-border pl-3 text-[15px] italic leading-relaxed text-muted-foreground" dangerouslySetInnerHTML={{ __html: html }} />
  }

  if (block.type === "code") {
    return <pre key={key} className="overflow-x-auto rounded-[6px] bg-card/80 px-3 py-2 font-mono text-[13px] leading-6 text-foreground dark:bg-white/[0.04]"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
  }

  if (block.type === "highlight") {
    return <div key={key} className="rounded-[6px] bg-[#fff2a8] px-3 py-1.5 text-[15px] leading-relaxed text-[#2d2a16] dark:bg-[#4a411e] dark:text-[#fff2b5]" dangerouslySetInnerHTML={{ __html: html }} />
  }

  if (block.type === "columns") {
    return <div key={key} className="columns-2 gap-8 text-[15px] leading-relaxed text-foreground/90 [column-gap:2rem]" dangerouslySetInnerHTML={{ __html: html }} />
  }

  return <p key={key} className="break-words text-[15px] leading-relaxed text-foreground/90" dangerouslySetInnerHTML={{ __html: html }} />
}
