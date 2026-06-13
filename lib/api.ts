import type { Asset, AssetList } from "./assets-data"
import type { Note, Notebook, NotesPage, TagSummary, CreateNoteInput, UpdateNoteInput, CreateNotebookInput } from "./notes-data"

const BASE = "/api"
const LOCAL_DESKTOP_TOKEN = "local-desktop-token"

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(status: number, payload: unknown, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.payload = payload
  }
}

export interface AuthSession {
  id: string
  current: boolean
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  ipAddress: string
  userAgent: string
}

function getToken(): string | null {
  if (typeof window === "undefined") return null
  if (window.electronAPI?.runtime === "electron") return LOCAL_DESKTOP_TOKEN
  return null
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function cookieValue(name: string): string | null {
  if (typeof document === "undefined") return null
  const prefix = `${name}=`
  const item = document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
  return item ? decodeURIComponent(item.slice(prefix.length)) : null
}

function csrfHeaders(method?: string): Record<string, string> {
  const normalized = (method || "GET").toUpperCase()
  if (normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS") return {}
  const token = cookieValue("veil_csrf")
  return token ? { "X-CSRF-Token": token } : {}
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method
  const res = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      ...authHeaders(),
      ...csrfHeaders(method),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (res.status === 401 && !window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/register")) {
      localStorage.removeItem("token")
      window.location.href = "/login"
    }
    throw new ApiError(res.status, err, err.error || `Request failed`)
  }
  return res.json()
}

async function fetchForm<T>(url: string, form: FormData, options?: RequestInit): Promise<T> {
  const method = options?.method || "POST"
  const res = await fetch(url, {
    ...options,
    method,
    credentials: "same-origin",
    body: form,
    headers: {
      ...options?.headers,
      ...authHeaders(),
      ...csrfHeaders(method),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (res.status === 401 && !window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/register")) {
      localStorage.removeItem("token")
      window.location.href = "/login"
    }
    throw new ApiError(res.status, err, err.error || `Request failed`)
  }
  return res.json()
}

function optionalBaseVersionParam(baseVersion?: number): string {
  return baseVersion === undefined ? "" : `&baseVersion=${encodeURIComponent(String(baseVersion))}`
}

// Auth
export async function register(username: string, password: string): Promise<{ id: string; username: string }> {
  return fetchJSON(`${BASE}/auth/register`, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
}

export async function login(username: string, password: string): Promise<{ id: string; username: string }> {
  return fetchJSON(`${BASE}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
}

export async function logout(): Promise<void> {
  await fetchJSON(`${BASE}/auth/logout`, {
    method: "POST",
  })
}

export async function getMe(): Promise<{ id: string; username: string }> {
  return fetchJSON(`${BASE}/auth/me`)
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await fetchJSON(`${BASE}/auth/password`, {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export async function getAuthSessions(): Promise<AuthSession[]> {
  const result = await fetchJSON<{ sessions: AuthSession[] }>(`${BASE}/auth/sessions`)
  return result.sessions
}

export async function revokeAuthSession(id: string): Promise<void> {
  await fetchJSON(`${BASE}/auth/sessions?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function revokeOtherAuthSessions(): Promise<{ revoked: number }> {
  return fetchJSON(`${BASE}/auth/sessions?scope=others`, {
    method: "DELETE",
  })
}

// Notes
export async function getNotes(notebook?: string): Promise<Note[]> {
  const params = notebook ? `?notebook=${encodeURIComponent(notebook)}` : ""
  return fetchJSON<Note[]>(`${BASE}/notes${params}`)
}

export async function getNotesPage(options: {
  notebook?: string
  q?: string
  tag?: string
  date?: string
  starred?: boolean
  cursor?: string
  limit?: number
} = {}): Promise<NotesPage> {
  const params = new URLSearchParams({ page: "true" })
  if (options.notebook) params.set("notebook", options.notebook)
  if (options.q) params.set("q", options.q)
  if (options.tag) params.set("tag", options.tag)
  if (options.date) params.set("date", options.date)
  if (options.starred !== undefined) params.set("starred", String(options.starred))
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  return fetchJSON<NotesPage>(`${BASE}/notes?${params.toString()}`)
}

export async function getNote(id: string): Promise<Note> {
  return fetchJSON<Note>(`${BASE}/notes?id=${encodeURIComponent(id)}`)
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  return fetchJSON<Note>(`${BASE}/notes`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  return fetchJSON<Note>(`${BASE}/notes?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export async function reorderNotes(noteIds: string[]): Promise<Note[]> {
  const result = await fetchJSON<{ notes: Note[] }>(`${BASE}/notes?action=reorder`, {
    method: "POST",
    body: JSON.stringify({ noteIds }),
  })
  return result.notes
}

export async function deleteNote(id: string, baseVersion?: number): Promise<void> {
  await fetchJSON(`${BASE}/notes?id=${encodeURIComponent(id)}${optionalBaseVersionParam(baseVersion)}`, {
    method: "DELETE",
  })
}

export async function getTrashNotes(): Promise<Note[]> {
  return fetchJSON<Note[]>(`${BASE}/notes?type=trash`)
}

export async function getTagSummaries(): Promise<TagSummary[]> {
  return fetchJSON<TagSummary[]>(`${BASE}/notes?type=tags`)
}

export async function restoreNote(id: string, baseVersion?: number): Promise<Note> {
  return fetchJSON<Note>(`${BASE}/notes?action=restore&id=${encodeURIComponent(id)}${optionalBaseVersionParam(baseVersion)}`, {
    method: "POST",
  })
}

export async function emptyTrash(): Promise<{ deleted: number }> {
  return fetchJSON(`${BASE}/notes?action=emptyTrash`, {
    method: "POST",
  })
}

export async function createPublicNoteShareLink(noteId: string): Promise<{ token: string; url: string }> {
  return fetchJSON(`${BASE}/share`, {
    method: "POST",
    body: JSON.stringify({ noteId }),
  })
}

// Assets
export async function uploadAsset(file: File): Promise<Asset> {
  const form = new FormData()
  form.set("file", file)
  return fetchForm<Asset>(`${BASE}/assets`, form)
}

export async function getAssets(limit?: number): Promise<AssetList> {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set("limit", String(limit))
  return fetchJSON<AssetList>(`${BASE}/assets${params.size ? `?${params.toString()}` : ""}`)
}

export async function deleteAsset(id: string, options: { force?: boolean } = {}): Promise<void> {
  const params = new URLSearchParams()
  if (options.force) params.set("force", "true")
  await fetchJSON(`${BASE}/assets/${encodeURIComponent(id)}${params.size ? `?${params.toString()}` : ""}`, {
    method: "DELETE",
  })
}

// Notebooks
export async function getNotebooks(): Promise<Notebook[]> {
  return fetchJSON<Notebook[]>(`${BASE}/notebooks`)
}

export async function createNotebook(input: CreateNotebookInput): Promise<Notebook> {
  return fetchJSON<Notebook>(`${BASE}/notebooks`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateNotebook(id: string, data: { name?: string; icon?: string }): Promise<Notebook> {
  return fetchJSON<Notebook>(`${BASE}/notebooks?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export async function deleteNotebook(id: string): Promise<void> {
  await fetchJSON(`${BASE}/notebooks?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function getFavorites(): Promise<Note[]> {
  return fetchJSON<Note[]>(`${BASE}/notebooks?type=favorites`)
}
