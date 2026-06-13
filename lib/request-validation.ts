import { z } from "zod"

export const usernameSchema = z
  .string()
  .trim()
  .min(2, "用户名至少 2 个字符")
  .max(50, "用户名不能超过 50 个字符")
  .regex(/^[\p{L}\p{N}_ .@-]+$/u, "用户名只能包含文字、数字、空格、点、下划线、@ 和连字符")

export const passwordSchema = z
  .string()
  .min(12, "密码至少 12 个字符")
  .max(128, "密码不能超过 128 个字符")

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "请输入密码").max(128, "密码不能超过 128 个字符"),
}).strict()

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
}).strict()

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(128, "密码不能超过 128 个字符"),
  newPassword: passwordSchema,
}).strict().refine((value) => value.currentPassword !== value.newPassword, {
  message: "新密码不能与当前密码相同",
  path: ["newPassword"],
})

export const noteBlockSchema = z.object({
  type: z.enum(["paragraph", "heading", "bullet", "todo", "ordered", "quote", "code", "highlight", "columns", "toggle"]),
  text: z.string().max(50_000, "单个内容块过长"),
  checked: z.boolean().optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  collapsed: z.boolean().optional(),
  showLineNumbers: z.boolean().optional(),
  toggleId: z.string().trim().min(1).max(120).optional(),
  toggleParentId: z.string().trim().min(1).max(120).optional(),
}).strict()

const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(30)
const parentIdSchema = z.string().trim().min(1).max(120)

export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notebook: z.string().trim().min(1).max(100).optional(),
  notebookIcon: z.string().trim().min(1).max(50).optional(),
  parentId: parentIdSchema.optional(),
  tags: tagsSchema.optional(),
  blocks: z.array(noteBlockSchema).max(1_000, "笔记内容块过多").optional(),
}).strict()

export const updateNoteSchema = createNoteSchema.partial().extend({
  excerpt: z.string().max(500).optional(),
  parentId: parentIdSchema.nullable().optional(),
  starred: z.boolean().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
  baseVersion: z.number().int().positive().optional(),
}).strict()

export const reorderNotesSchema = z.object({
  noteIds: z.array(parentIdSchema).min(2).max(500),
}).strict()

export const createNotebookSchema = z.object({
  name: z.string().trim().min(1, "笔记本名称不能为空").max(100, "笔记本名称不能超过 100 个字符"),
  icon: z.string().trim().min(1).max(50).optional(),
}).strict()

export const updateNotebookSchema = createNotebookSchema.partial().strict()

export const syncPushItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  markdown: z.string().max(1_000_000),
  updatedAt: z.string().datetime(),
  baseVersion: z.number().int().positive().optional(),
  version: z.number().int().positive().optional(),
  contentHash: z.string().trim().min(1).max(128).optional(),
  deleted: z.boolean().optional(),
}).strict()

export const syncRequestSchema = z.object({
  changes: z.array(syncPushItemSchema).max(500).optional(),
  since: z.string().datetime().optional(),
}).strict()

export const publicShareSchema = z.object({
  noteId: z.string().trim().min(1).max(120),
}).strict()

export function validationErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "请求数据格式无效"
}
