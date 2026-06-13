import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { ensureCsrf, parseJsonBody, unauthorized } from "@/lib/api-route"
import { getSessionFromRequest } from "@/lib/user-store"

export const runtime = "nodejs"

const aiContextNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().max(500).optional(),
  content: z.string().max(12_000).optional(),
  notebook: z.string().max(100).optional(),
}).strict()

const aiRequestSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  context: z.array(aiContextNoteSchema).max(8).default([]),
}).strict()

type NormalizedAiRequest = {
  message: string
  context: z.infer<typeof aiContextNoteSchema>[]
}

export async function POST(request: NextRequest) {
  const csrfError = ensureCsrf(request)
  if (csrfError) return csrfError

  const session = await getSessionFromRequest(request)
  if (!session) return unauthorized()

  const parsed = await parseJsonBody(request, aiRequestSchema)
  if ("response" in parsed) return parsed.response

  const input: NormalizedAiRequest = {
    message: parsed.data.message,
    context: parsed.data.context ?? [],
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(localAssistantResponse(input))
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: "你是 Veil 笔记里的中文写作与整理助手。回答要直接、可执行，优先基于用户给出的笔记上下文，不要编造未提供的事实。",
          },
          {
            role: "user",
            content: buildPrompt(input),
          },
        ],
      }),
    })

    if (!response.ok) {
      return NextResponse.json(localAssistantResponse(input))
    }

    const data = await response.json() as { output_text?: unknown }
    const answer = typeof data.output_text === "string" && data.output_text.trim()
      ? data.output_text.trim()
      : localAssistantResponse(input).answer

    return NextResponse.json({
      answer,
      source: "ai",
      suggestions: defaultSuggestions(input),
    })
  } catch {
    return NextResponse.json(localAssistantResponse(input))
  }
}

function buildPrompt(input: NormalizedAiRequest): string {
  const context = input.context.length
    ? input.context.map((note, index) => [
      `# 笔记 ${index + 1}: ${note.title}`,
      note.notebook ? `笔记本: ${note.notebook}` : "",
      note.excerpt ? `摘要: ${note.excerpt}` : "",
      note.content ? `内容:\n${note.content}` : "",
    ].filter(Boolean).join("\n")).join("\n\n")
    : "没有提供笔记上下文。"

  return `用户问题:\n${input.message}\n\n笔记上下文:\n${context}`
}

function localAssistantResponse(input: NormalizedAiRequest) {
  const context = input.context
  const suggestions = defaultSuggestions(input)
  if (context.length === 0) {
    return {
      answer: "我还没有拿到可整理的笔记内容。你可以先打开一篇笔记，或者在某个笔记本里再进入 AI 助手。",
      source: "local" as const,
      suggestions,
    }
  }

  const lines = context.flatMap((note) => noteText(note).split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
  const taskLines = lines.filter((line) => /待办|todo|下一步|需要|必须|完成|修复|添加|配置|检查|发布/i.test(line)).slice(0, 6)
  const highlights = lines.filter((line) => line.length >= 8).slice(0, 5)

  const answer = [
    `已基于 ${context.length} 篇笔记做了本地整理：`,
    "",
    ...context.slice(0, 5).map((note) => `- ${note.title}${note.excerpt ? `：${note.excerpt}` : ""}`),
    "",
    taskLines.length ? "可能的待办：" : "可优先关注：",
    ...(taskLines.length ? taskLines : highlights).map((line) => `- ${line.slice(0, 120)}`),
  ].join("\n")

  return {
    answer,
    source: "local" as const,
    suggestions,
  }
}

function noteText(note: NormalizedAiRequest["context"][number]): string {
  return [note.title, note.excerpt, note.content].filter(Boolean).join("\n")
}

function defaultSuggestions(input: NormalizedAiRequest): string[] {
  return input.context.length
    ? ["总结当前笔记", "提炼待办事项", "生成复习提纲"]
    : ["打开一篇笔记后总结", "选择一个笔记本整理", "列出最近笔记重点"]
}
