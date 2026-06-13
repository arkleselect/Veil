import type { HeadingLevel, Note, NoteBlock } from "@/lib/notes-data"
import { computeNoteContentHash } from "@/lib/note-version"

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "")
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function safeImageSrc(value: string): string | null {
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

function imageAttribute(tag: string, name: string): string {
  const attrs = tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g)
  for (const attr of attrs) {
    if (attr[1].toLowerCase() === name) return attr[2] ?? attr[3] ?? attr[4] ?? ""
  }
  return ""
}

function markdownImageAlt(value: string): string {
  return decodeHtmlEntities(value).replace(/[\r\n[\]]/g, " ").trim()
}

function markdownImageSrc(value: string): string {
  return value
    .replace(/\s/g, "%20")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
}

function imageTagToMarkdown(tag: string): string {
  const src = safeImageSrc(imageAttribute(tag, "src"))
  if (!src) return ""
  return `![${markdownImageAlt(imageAttribute(tag, "alt"))}](${markdownImageSrc(src)})`
}

function htmlToMarkdownText(html: string): string {
  const withImages = html.replace(/<img\b[^>]*>/gi, (tag) => imageTagToMarkdown(tag))
  return stripHtml(withImages)
}

function codeHtmlToText(html: string): string {
  const withLineBreaks = html
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

function markdownImagesToHtml(text: string): string {
  const imagePattern = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let result = ""
  let lastIndex = 0

  for (const match of text.matchAll(imagePattern)) {
    const index = match.index ?? 0
    result += escapeHtml(text.slice(lastIndex, index))
    const src = safeImageSrc(match[2])
    if (src) {
      result += `<img src="${escapeHtml(src)}" alt="${escapeHtml(match[1])}" loading="lazy" class="max-w-full rounded-lg">`
    } else {
      result += escapeHtml(match[0])
    }
    lastIndex = index + match[0].length
  }

  return result + escapeHtml(text.slice(lastIndex))
}

function normalizeHeadingLevel(value: unknown): HeadingLevel {
  return value === 2 || value === 3 ? value : 1
}

function headingBlock(text: string, level: HeadingLevel): NoteBlock {
  return level === 1 ? { type: "heading", text } : { type: "heading", text, level }
}

function frontmatterString(value: string): string {
  return JSON.stringify(value)
}

function parseFrontmatterString(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === "string") return parsed
    } catch {
      // Fall through to the legacy quoted-string parser.
    }
  }
  return trimmed.replace(/^"|"$/g, "")
}

function markdownBlocks(blocks: NoteBlock[]): NoteBlock[] {
  return blocks.map((block) => ({
    ...block,
    text: block.type === "code" ? codeHtmlToText(block.text) : htmlToMarkdownText(block.text),
  }))
}

function codeFenceFor(text: string): string {
  const maxBacktickRun = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
  return "`".repeat(maxBacktickRun + 1)
}

export function generateExcerpt(blocks: NoteBlock[]): string {
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "heading" || block.type === "highlight" || block.type === "columns" || block.type === "toggle") {
      const plain = stripHtml(block.text)
      return plain.length > 80 ? `${plain.slice(0, 80)}...` : plain
    }
  }
  return ""
}

export function noteToMarkdown(note: Note): string {
  const blocks = markdownBlocks(note.blocks)
  const encodedNote: Note = {
    ...note,
    blocks,
    contentHash: "",
  }
  const contentHash = computeNoteContentHash(encodedNote)
  let md = `---
title: ${frontmatterString(note.title)}
excerpt: ${frontmatterString(note.excerpt)}
date: ${note.date}
notebook: ${frontmatterString(note.notebook)}
notebookIcon: ${frontmatterString(note.notebookIcon)}
parentId: ${note.parentId ?? ""}
tags: ${JSON.stringify(note.tags)}
starred: ${note.starred}
version: ${note.version}
contentHash: ${contentHash}
sortOrder: ${note.sortOrder ?? ""}
createdAt: ${note.createdAt}
updatedAt: ${note.updatedAt}
deletedAt: ${note.deletedAt ?? ""}
---

`
  for (const block of blocks) {
    const text = block.text
    switch (block.type) {
      case "heading":
        md += `${"#".repeat(normalizeHeadingLevel(block.level))} ${text}\n\n`
        break
      case "bullet":
        md += `- ${text}\n`
        break
      case "todo":
        md += `- [${block.checked ? "x" : " "}] ${text}\n`
        break
      case "ordered":
        md += `1. ${text}\n`
        break
      case "quote":
        md += `> ${text}\n\n`
        break
      case "code": {
        const fence = codeFenceFor(text)
        md += `${fence}\n${text}\n${fence}\n\n`
        break
      }
      case "highlight":
      case "columns":
      case "toggle":
        md += `${text}\n\n`
        break
      case "paragraph":
      default:
        md += `${text}\n\n`
        break
    }
  }
  return `${md.trim()}\n`
}

export function markdownToNote(md: string, id?: string): Note {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  let title = "无标题笔记"
  let date = today
  let notebook = "默认笔记本"
  let notebookIcon = "BookOpen"
  let parentId: string | undefined
  let excerpt: string | undefined
  const tags: string[] = []
  let starred = false
  let version = 1
  let sortOrder: number | undefined
  let createdAt = now
  let updatedAt = now
  let deletedAt: string | undefined

  const frontmatterMatch = md.match(/^---\n([\s\S]*?)\n---\n/)
  let body = md
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1]
    body = md.slice(frontmatterMatch[0].length)
    for (const line of fm.split("\n")) {
      if (line.startsWith("title: ")) title = parseFrontmatterString(line.slice(7))
      if (line.startsWith("excerpt: ")) excerpt = parseFrontmatterString(line.slice(9))
      if (line.startsWith("date: ")) date = line.slice(6).trim()
      if (line.startsWith("notebook: ")) notebook = parseFrontmatterString(line.slice(10))
      if (line.startsWith("notebookIcon: ")) notebookIcon = parseFrontmatterString(line.slice(14))
      if (line.startsWith("parentId: ")) {
        const value = line.slice(10).trim()
        if (value) parentId = value
      }
      if (line.startsWith("tags: ")) {
        const raw = line.slice(6).trim()
        if (raw.startsWith("[")) {
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) tags.push(...parsed.filter((tag): tag is string => typeof tag === "string"))
          } catch {
            // Ignore malformed tag frontmatter from external files.
          }
        }
      }
      if (line.startsWith("starred: ")) starred = line.slice(9).trim() === "true"
      if (line.startsWith("version: ")) {
        const parsed = Number(line.slice(9).trim())
        if (Number.isInteger(parsed) && parsed > 0) version = parsed
      }
      if (line.startsWith("sortOrder: ")) {
        const value = line.slice(11).trim()
        if (value) {
          const parsed = Number(value)
          if (Number.isFinite(parsed)) sortOrder = parsed
        }
      }
      if (line.startsWith("createdAt: ")) {
        const value = line.slice(11).trim()
        if (value) createdAt = value
      }
      if (line.startsWith("updatedAt: ")) {
        const value = line.slice(11).trim()
        if (value) updatedAt = value
      }
      if (line.startsWith("deletedAt: ")) {
        const value = line.slice(11).trim()
        if (value) deletedAt = value
      }
    }
  }

  const blocks: NoteBlock[] = []
  const lines = body.split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed) continue
    const codeFenceMatch = trimmed.match(/^(`{3,})(.*)$/)
    if (codeFenceMatch) {
      const fence = codeFenceMatch[1]
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(fence)) {
        codeLines.push(lines[index])
        index += 1
      }
      blocks.push({ type: "code", text: escapeHtml(codeLines.join("\n")) })
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      blocks.push(headingBlock(markdownImagesToHtml(headingMatch[2]), headingMatch[1].length as HeadingLevel))
    } else if (trimmed.startsWith("- [x] ") || trimmed.startsWith("- [X] ")) {
      blocks.push({ type: "todo", text: markdownImagesToHtml(trimmed.slice(6)), checked: true })
    } else if (trimmed.startsWith("- [ ] ")) {
      blocks.push({ type: "todo", text: markdownImagesToHtml(trimmed.slice(6)), checked: false })
    } else if (trimmed.startsWith("- ")) {
      blocks.push({ type: "bullet", text: markdownImagesToHtml(trimmed.slice(2)) })
    } else if (trimmed.startsWith("> ")) {
      blocks.push({ type: "quote", text: markdownImagesToHtml(trimmed.slice(2)) })
    } else if (trimmed.match(/^\d+\.\s/)) {
      blocks.push({ type: "ordered", text: markdownImagesToHtml(trimmed.replace(/^\d+\.\s/, "")) })
    } else {
      blocks.push({ type: "paragraph", text: markdownImagesToHtml(trimmed) })
    }
  }

  if (blocks.length === 0) blocks.push({ type: "paragraph", text: "" })

  const note: Note = {
    id: id || generateId(),
    title,
    excerpt: excerpt ?? generateExcerpt(blocks),
    notebook,
    notebookIcon,
    ...(parentId ? { parentId } : {}),
    date,
    starred,
    tags,
    blocks,
    version,
    contentHash: "",
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    createdAt,
    updatedAt,
    ...(deletedAt ? { deletedAt } : {}),
  }

  return {
    ...note,
    contentHash: computeNoteContentHash(note),
  }
}
