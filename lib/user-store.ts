import crypto from "crypto"
import { promisify } from "util"
import { NextRequest } from "next/server"
import type { PoolClient, QueryResultRow } from "pg"
import { query, withTransaction } from "@/lib/db"

export const LOCAL_DESKTOP_USER_ID = "__local_desktop__"
export const SESSION_COOKIE_NAME = "veil_session"
const LOCAL_DESKTOP_TOKEN = "local-desktop-token"
const scryptAsync = promisify(crypto.scrypt)

export function isLocalDesktopToken(token: string): boolean {
  return token === LOCAL_DESKTOP_TOKEN && process.env.VEIL_DESKTOP_RUNTIME === "1"
}

export async function getUserIdFromRequest(request: NextRequest): Promise<string> {
  const user = await getSessionFromRequest(request)
  return user ? user.id : ""
}

export async function getSessionFromRequest(request: NextRequest): Promise<UserSession | null> {
  const auth = request.headers.get("authorization")
  if (auth?.startsWith("Bearer ")) {
    const bearerToken = auth.slice(7)
    if (isLocalDesktopToken(bearerToken)) {
      return { id: LOCAL_DESKTOP_USER_ID, username: "本地仓库", token: bearerToken }
    }
    return validateToken(bearerToken)
  }

  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  return cookieToken ? validateToken(cookieToken) : null
}

export interface UserSession {
  id: string
  username: string
  token: string
  sessionId?: string
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  salt: string
  token: string | null
  token_expires_at: Date | string | null
}

interface SessionRow {
  session_id: string
  id: string
  username: string
  expires_at: Date | string
  revoked_at: Date | string | null
}

interface UserSessionRow {
  id: string
  created_at: Date | string
  last_seen_at: Date | string
  expires_at: Date | string
  revoked_at: Date | string | null
  ip_address: string
  user_agent: string
}

export interface AuthRequestMetadata {
  ipAddress?: string
  userAgent?: string
}

export interface UserSessionInfo {
  id: string
  current: boolean
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  ipAddress: string
  userAgent: string
}

interface LoginLockoutStatus {
  locked: boolean
  retryAfter?: number
  lockedUntil?: Date
}

type QueryExecutor = {
  query<T extends QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const DEFAULT_LOGIN_LOCKOUT_FAILURES = 10
const DEFAULT_LOGIN_LOCKOUT_WINDOW_MINUTES = 15
const DEFAULT_LOGIN_LOCKOUT_DURATION_MINUTES = 15

async function hashPassword(password: string, salt: string): Promise<string> {
  const hash = await scryptAsync(password, salt, 64) as Buffer
  return hash.toString("hex")
}

async function verifyPassword(password: string, salt: string, passwordHash: string): Promise<boolean> {
  const hash = Buffer.from(await hashPassword(password, salt), "hex")
  const expected = Buffer.from(passwordHash, "hex")
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected)
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex")
}

function generateToken(): string {
  return crypto.randomBytes(48).toString("base64url")
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function newTokenExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS)
}

function generateId(): string {
  return crypto.randomUUID()
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function loginLockoutConfig() {
  return {
    failures: positiveIntegerEnv("VEIL_AUTH_LOCKOUT_FAILURES", DEFAULT_LOGIN_LOCKOUT_FAILURES),
    windowSeconds: positiveIntegerEnv(
      "VEIL_AUTH_LOCKOUT_WINDOW_MINUTES",
      DEFAULT_LOGIN_LOCKOUT_WINDOW_MINUTES,
    ) * 60,
    durationSeconds: positiveIntegerEnv(
      "VEIL_AUTH_LOCKOUT_DURATION_MINUTES",
      DEFAULT_LOGIN_LOCKOUT_DURATION_MINUTES,
    ) * 60,
  }
}

function normalizedRequestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const realIp = request.headers.get("x-real-ip")?.trim()
  return (forwardedFor || realIp || "").slice(0, 160)
}

export function authRequestMetadata(request: NextRequest): AuthRequestMetadata {
  return {
    ipAddress: normalizedRequestIp(request),
    userAgent: (request.headers.get("user-agent") || "").slice(0, 500),
  }
}

async function createSession(
  client: Pick<PoolClient, "query">,
  userId: string,
  token: string,
  metadata: AuthRequestMetadata = {},
): Promise<string> {
  const sessionId = generateId()
  await client.query(
    `
      INSERT INTO user_sessions (
        id, user_id, token_hash, expires_at, ip_address, user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      sessionId,
      userId,
      tokenHash(token),
      newTokenExpiry(),
      metadata.ipAddress || "",
      metadata.userAgent || "",
    ],
  )
  return sessionId
}

async function recordAuthEvent(
  client: Pick<PoolClient, "query">,
  input: {
    userId?: string | null
    username?: string
    eventType: string
    success: boolean
    metadata?: AuthRequestMetadata
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO auth_events (user_id, username, event_type, success, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      input.userId || null,
      input.username || "",
      input.eventType,
      input.success,
      input.metadata?.ipAddress || "",
      input.metadata?.userAgent || "",
    ],
  )
}

async function loginLockoutStatus(
  client: QueryExecutor,
  username: string,
): Promise<LoginLockoutStatus> {
  const config = loginLockoutConfig()
  const result = await client.query<{ failure_count: number | string; last_failed_at: Date | string | null }>(
    `
      SELECT COUNT(*) AS failure_count, MAX(created_at) AS last_failed_at
      FROM auth_events
      WHERE lower(username) = lower($1)
        AND event_type = 'login_failed'
        AND success = FALSE
        AND created_at > COALESCE(
          (
            SELECT MAX(created_at)
            FROM auth_events
            WHERE lower(username) = lower($1)
              AND event_type = 'login_succeeded'
              AND success = TRUE
          ),
          '-infinity'::timestamptz
        )
        AND created_at >= NOW() - ($2::int * INTERVAL '1 second')
    `,
    [username, config.windowSeconds],
  )
  const row = result.rows[0]
  const failureCount = Number(row?.failure_count ?? 0)
  if (failureCount < config.failures || !row?.last_failed_at) return { locked: false }

  const lockedUntil = new Date(new Date(row.last_failed_at).getTime() + config.durationSeconds * 1000)
  const retryAfter = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
  return retryAfter > 0
    ? { locked: true, retryAfter, lockedUntil }
    : { locked: false }
}

async function recordLoginFailure(
  username: string,
  userId: string | null,
  metadata: AuthRequestMetadata,
): Promise<LoginLockoutStatus> {
  return withTransaction(async (client) => {
    await recordAuthEvent(client, {
      userId,
      username,
      eventType: "login_failed",
      success: false,
      metadata,
    })
    return loginLockoutStatus(client, username)
  })
}

async function recordLoginLocked(
  username: string,
  userId: string | null,
  metadata: AuthRequestMetadata,
): Promise<void> {
  await query(
    `
      INSERT INTO auth_events (user_id, username, event_type, success, ip_address, user_agent)
      VALUES ($1, $2, 'login_locked', FALSE, $3, $4)
    `,
    [
      userId,
      username,
      metadata.ipAddress || "",
      metadata.userAgent || "",
    ],
  )
}

function lockedLoginResult(status: LoginLockoutStatus): { ok: false; error: string; status: number; retryAfter?: number } {
  return {
    ok: false,
    error: "账号暂时锁定，请稍后再试",
    status: 423,
    ...(status.retryAfter ? { retryAfter: status.retryAfter } : {}),
  }
}

export async function registerUser(
  username: string,
  password: string,
  metadata: AuthRequestMetadata = {},
): Promise<{ ok: boolean; error?: string; user?: UserSession }> {
  const normalizedUsername = username.trim()
  if (!normalizedUsername || normalizedUsername.length < 2) {
    return { ok: false, error: "用户名至少 2 个字符" }
  }
  if (!password || password.length < 12) {
    return { ok: false, error: "密码至少 12 个字符" }
  }

  const existing = await query<{ id: string }>(
    "SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1",
    [normalizedUsername],
  )
  if ((existing.rowCount ?? 0) > 0) {
    return { ok: false, error: "用户名已存在" }
  }

  const salt = generateSalt()
  const token = generateToken()
  const user = {
    id: generateId(),
    username: normalizedUsername,
    passwordHash: await hashPassword(password, salt),
    salt,
  }

  try {
    const sessionId = await withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO users (id, username, password_hash, salt)
          VALUES ($1, $2, $3, $4)
        `,
        [user.id, user.username, user.passwordHash, user.salt],
      )
      const createdSessionId = await createSession(client, user.id, token, metadata)
      await recordAuthEvent(client, {
        userId: user.id,
        username: user.username,
        eventType: "register_succeeded",
        success: true,
        metadata,
      })
      return createdSessionId
    })

    return {
      ok: true,
      user: { id: user.id, username: user.username, token, sessionId },
    }
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: "用户名已存在" }
    }
    throw error
  }
}

export async function loginUser(
  username: string,
  password: string,
  metadata: AuthRequestMetadata = {},
): Promise<{ ok: boolean; error?: string; user?: UserSession; status?: number; retryAfter?: number }> {
  const normalizedUsername = username.trim()
  const initialLockout = await loginLockoutStatus({ query }, normalizedUsername)
  if (initialLockout.locked) {
    await recordLoginLocked(normalizedUsername, null, metadata)
    return lockedLoginResult(initialLockout)
  }

  const result = await query<UserRow>(
    "SELECT id, username, password_hash, salt, token, token_expires_at FROM users WHERE lower(username) = lower($1) LIMIT 1",
    [normalizedUsername],
  )
  const user = result.rows[0]
  if (!user) {
    const lockout = await recordLoginFailure(normalizedUsername, null, metadata)
    if (lockout.locked) return lockedLoginResult(lockout)
    return { ok: false, error: "用户名或密码错误" }
  }

  if (!(await verifyPassword(password, user.salt, user.password_hash))) {
    const lockout = await recordLoginFailure(user.username, user.id, metadata)
    if (lockout.locked) return lockedLoginResult(lockout)
    return { ok: false, error: "用户名或密码错误" }
  }

  const token = generateToken()
  const sessionId = await withTransaction(async (client) => {
    const createdSessionId = await createSession(client, user.id, token, metadata)
    await recordAuthEvent(client, {
      userId: user.id,
      username: user.username,
      eventType: "login_succeeded",
      success: true,
      metadata,
    })
    return createdSessionId
  })

  return {
    ok: true,
    user: { id: user.id, username: user.username, token, sessionId },
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  metadata: AuthRequestMetadata = {},
): Promise<{ ok: boolean; error?: string; user?: UserSession }> {
  if (userId === LOCAL_DESKTOP_USER_ID) {
    return { ok: false, error: "本地仓库不支持修改密码" }
  }
  if (!newPassword || newPassword.length < 12) {
    return { ok: false, error: "密码至少 12 个字符" }
  }

  const token = generateToken()
  return withTransaction(async (client) => {
    const result = await client.query<UserRow>(
      "SELECT id, username, password_hash, salt, token, token_expires_at FROM users WHERE id = $1 LIMIT 1 FOR UPDATE",
      [userId],
    )
    const user = result.rows[0]
    if (!user) {
      return { ok: false, error: "用户不存在" }
    }
    if (!(await verifyPassword(currentPassword, user.salt, user.password_hash))) {
      await recordAuthEvent(client, {
        userId: user.id,
        username: user.username,
        eventType: "password_change_failed",
        success: false,
        metadata,
      })
      return { ok: false, error: "当前密码错误" }
    }
    if (await verifyPassword(newPassword, user.salt, user.password_hash)) {
      return { ok: false, error: "新密码不能与当前密码相同" }
    }

    const salt = generateSalt()
    const passwordHash = await hashPassword(newPassword, salt)
    await client.query(
      "UPDATE users SET password_hash = $1, salt = $2, token = NULL, token_expires_at = NULL WHERE id = $3",
      [passwordHash, salt, user.id],
    )
    await client.query(
      "UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1",
      [user.id],
    )
    const sessionId = await createSession(client, user.id, token, metadata)
    await recordAuthEvent(client, {
      userId: user.id,
      username: user.username,
      eventType: "password_changed",
      success: true,
      metadata,
    })

    return {
      ok: true,
      user: { id: user.id, username: user.username, token, sessionId },
    }
  })
}

async function validateLegacyUserToken(token: string): Promise<UserSession | null> {
  const result = await query<UserRow>(
    "SELECT id, username, password_hash, salt, token, token_expires_at FROM users WHERE token = $1 LIMIT 1",
    [token],
  )
  const user = result.rows[0]
  if (!user || !user.token) return null

  if (user.token_expires_at && new Date(user.token_expires_at).getTime() <= Date.now()) {
    await query("UPDATE users SET token = NULL, token_expires_at = NULL WHERE id = $1", [user.id])
    return null
  }

  return {
    id: user.id,
    username: user.username,
    token: user.token,
  }
}

export async function validateToken(token: string): Promise<UserSession | null> {
  if (isLocalDesktopToken(token)) {
    return { id: LOCAL_DESKTOP_USER_ID, username: "本地仓库", token }
  }

  const result = await query<SessionRow>(
    `
      SELECT
        s.id AS session_id,
        u.id,
        u.username,
        s.expires_at,
        s.revoked_at
      FROM user_sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
      LIMIT 1
    `,
    [tokenHash(token)],
  )
  const session = result.rows[0]
  if (!session) return validateLegacyUserToken(token)
  if (session.revoked_at) return null

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await query(
      "UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1",
      [session.session_id],
    )
    return null
  }

  await query(
    "UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1 AND last_seen_at < NOW() - INTERVAL '5 minutes'",
    [session.session_id],
  )

  return { id: session.id, username: session.username, token, sessionId: session.session_id }
}

export async function revokeToken(token: string): Promise<void> {
  if (!token || isLocalDesktopToken(token)) return
  await query(
    "UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE token_hash = $1",
    [tokenHash(token)],
  )
  await query("UPDATE users SET token = NULL, token_expires_at = NULL WHERE token = $1", [token])
}

export async function listUserSessions(
  userId: string,
  currentSessionId?: string,
): Promise<UserSessionInfo[]> {
  if (userId === LOCAL_DESKTOP_USER_ID) return []

  const result = await query<UserSessionRow>(
    `
      SELECT id, created_at, last_seen_at, expires_at, revoked_at, ip_address, user_agent
      FROM user_sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY
        CASE WHEN id = $2 THEN 0 ELSE 1 END,
        last_seen_at DESC,
        created_at DESC
    `,
    [userId, currentSessionId ?? ""],
  )

  return result.rows.map((row) => ({
    id: row.id,
    current: row.id === currentSessionId,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    expiresAt: toIso(row.expires_at),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  }))
}

export async function revokeUserSession(
  userId: string,
  sessionId: string,
  currentSessionId?: string,
  metadata: AuthRequestMetadata = {},
): Promise<{ revoked: boolean; current: boolean }> {
  if (userId === LOCAL_DESKTOP_USER_ID) return { revoked: false, current: false }
  if (sessionId === currentSessionId) return { revoked: false, current: true }

  return withTransaction(async (client) => {
    const result = await client.query(
      `
        UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE user_id = $1
          AND id = $2
          AND revoked_at IS NULL
        RETURNING id
      `,
      [userId, sessionId],
    )
    const revoked = (result.rowCount ?? 0) > 0
    if (revoked) {
      await recordAuthEvent(client, {
        userId,
        eventType: "session_revoked",
        success: true,
        metadata,
      })
    }
    return { revoked, current: false }
  })
}

export async function revokeOtherUserSessions(
  userId: string,
  currentSessionId?: string,
  metadata: AuthRequestMetadata = {},
): Promise<number> {
  if (userId === LOCAL_DESKTOP_USER_ID || !currentSessionId) return 0

  return withTransaction(async (client) => {
    const result = await client.query(
      `
        UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE user_id = $1
          AND id <> $2
          AND revoked_at IS NULL
        RETURNING id
      `,
      [userId, currentSessionId],
    )
    const revoked = result.rowCount ?? 0
    if (revoked > 0) {
      await recordAuthEvent(client, {
        userId,
        eventType: "other_sessions_revoked",
        success: true,
        metadata,
      })
    }
    return revoked
  })
}
