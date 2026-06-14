import { describe, expect, it } from "vitest"
import type { Note } from "@/lib/notes-data"
import { markdownToNote, noteToMarkdown } from "@/lib/note-codec"

describe("note-codec", () => {
  it("round-trips note metadata used by sync and local vault", () => {
    const note: Note = {
      id: "note-1",
      title: 'Quoted "Title"',
      excerpt: "excerpt",
      notebook: 'Work "Notes"',
      notebookIcon: "Briefcase",
      date: "2026-06-08",
      starred: true,
      tags: ["design", "sync"],
      blocks: [
        { type: "heading", text: "<strong>Plan</strong>" },
        { type: "todo", text: "Ship tests", checked: true },
      ],
      version: 3,
      contentHash: "",
      sortOrder: 12345,
      createdAt: "2026-06-08T01:02:03.000Z",
      updatedAt: "2026-06-08T04:05:06.000Z",
      deletedAt: "2026-06-09T00:00:00.000Z",
    }

    const decoded = markdownToNote(noteToMarkdown(note), note.id)

    expect(decoded).toMatchObject({
      id: note.id,
      title: note.title,
      notebook: note.notebook,
      notebookIcon: note.notebookIcon,
      date: note.date,
      starred: note.starred,
      tags: note.tags,
      version: note.version,
      sortOrder: note.sortOrder,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      deletedAt: note.deletedAt,
    })
    expect(decoded.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(decoded.blocks).toEqual([
      { type: "heading", text: "Plan" },
      { type: "todo", text: "Ship tests", checked: true },
    ])
  })

  it("escapes raw markdown body text imported from external files", () => {
    const decoded = markdownToNote(`---
title: "Unsafe"
date: 2026-06-08
notebook: "Inbox"
tags: []
starred: false
---

<script>alert("x")</script>
`, "unsafe")

    expect(decoded.blocks[0]).toEqual({
      type: "paragraph",
      text: "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    })
    expect(decoded.excerpt).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
  })

  it("preserves safe image references for local vault markdown", () => {
    const note: Note = {
      id: "image-note",
      title: "Image",
      excerpt: "",
      notebook: "Inbox",
      notebookIcon: "BookOpen",
      date: "2026-06-08",
      starred: false,
      tags: [],
      blocks: [
        { type: "paragraph", text: 'Before <img src="/api/assets/asset-1" alt="Diagram"> after' },
      ],
      version: 1,
      contentHash: "",
      createdAt: "2026-06-08T01:02:03.000Z",
      updatedAt: "2026-06-08T04:05:06.000Z",
    }

    const markdown = noteToMarkdown(note)
    const decoded = markdownToNote(markdown, note.id)

    expect(markdown).toContain("Before ![Diagram](/api/assets/asset-1) after")
    expect(decoded.blocks[0].text).toBe('Before <img src="/api/assets/asset-1" alt="Diagram" loading="lazy" class="max-w-full rounded-lg"> after')
  })

  it("preserves heading levels in markdown", () => {
    const note: Note = {
      id: "heading-note",
      title: "Heading",
      excerpt: "",
      notebook: "Inbox",
      notebookIcon: "BookOpen",
      date: "2026-06-08",
      starred: false,
      tags: [],
      blocks: [
        { type: "heading", text: "Level 1" },
        { type: "heading", text: "Level 2", level: 2 },
        { type: "heading", text: "Level 3", level: 3 },
      ],
      version: 1,
      contentHash: "",
      createdAt: "2026-06-08T01:02:03.000Z",
      updatedAt: "2026-06-08T04:05:06.000Z",
    }

    const markdown = noteToMarkdown(note)
    const decoded = markdownToNote(markdown, note.id)

    expect(markdown).toContain("# Level 1")
    expect(markdown).toContain("## Level 2")
    expect(markdown).toContain("### Level 3")
    expect(decoded.blocks).toEqual([
      { type: "heading", text: "Level 1" },
      { type: "heading", text: "Level 2", level: 2 },
      { type: "heading", text: "Level 3", level: 3 },
    ])
  })

  it("preserves list indentation and ordered list groups", () => {
    const note: Note = {
      id: "list-note",
      title: "Lists",
      excerpt: "",
      notebook: "Inbox",
      notebookIcon: "BookOpen",
      date: "2026-06-08",
      starred: false,
      tags: [],
      blocks: [
        { type: "ordered", text: "One" },
        { type: "ordered", text: "Child one", indent: 1 },
        { type: "ordered", text: "Child two", indent: 1 },
        { type: "ordered", text: "Two" },
        { type: "paragraph", text: "Break" },
        { type: "ordered", text: "Restart" },
        { type: "bullet", text: "Nested bullet", indent: 2 },
      ],
      version: 1,
      contentHash: "",
      createdAt: "2026-06-08T01:02:03.000Z",
      updatedAt: "2026-06-08T04:05:06.000Z",
    }

    const markdown = noteToMarkdown(note)
    const decoded = markdownToNote(`${markdown}\n  1) Imported child`, note.id)

    expect(markdown).toContain("1. One\n  1. Child one\n  2. Child two\n2. Two")
    expect(markdown).toContain("Break\n\n1. Restart")
    expect(markdown).toContain("    - Nested bullet")
    expect(decoded.blocks).toEqual([
      { type: "ordered", text: "One" },
      { type: "ordered", text: "Child one", indent: 1 },
      { type: "ordered", text: "Child two", indent: 1 },
      { type: "ordered", text: "Two" },
      { type: "paragraph", text: "Break" },
      { type: "ordered", text: "Restart" },
      { type: "bullet", text: "Nested bullet", indent: 2 },
      { type: "ordered", text: "Imported child", indent: 1 },
    ])
  })

  it("round-trips fenced code blocks as literal text", () => {
    const note: Note = {
      id: "code-note",
      title: "Code",
      excerpt: "",
      notebook: "Inbox",
      notebookIcon: "BookOpen",
      date: "2026-06-08",
      starred: false,
      tags: [],
      blocks: [
        { type: "code", text: "const html = &quot;&lt;div&gt;ok&lt;/div&gt;&quot;\nconsole.log(html)" },
      ],
      version: 1,
      contentHash: "",
      createdAt: "2026-06-08T01:02:03.000Z",
      updatedAt: "2026-06-08T04:05:06.000Z",
    }

    const markdown = noteToMarkdown(note)
    const decoded = markdownToNote(markdown, note.id)

    expect(markdown).toContain("```\nconst html = \"<div>ok</div>\"\nconsole.log(html)\n```")
    expect(decoded.blocks).toEqual([
      { type: "code", text: "const html = &quot;&lt;div&gt;ok&lt;/div&gt;&quot;\nconsole.log(html)" },
    ])
  })
})
