import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"
import { isDatabaseUnavailableError } from "@/lib/db"
import { validationErrorMessage } from "@/lib/request-validation"
import { isLocalDesktopToken, SESSION_COOKIE_NAME } from "@/lib/user-store"

export const CSRF_COOKIE_NAME = "veil_csrf"
export const DATABASE_UNAVAILABLE_RESPONSE_MESSAGE = "云端数据库不可用，请检查 DATABASE_URL 配置"
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function secureCookies(): boolean {
  if (process.env.VEIL_COOKIE_SECURE === "false") return false
  return process.env.NODE_ENV === "production"
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

export function unauthorized(error = "未登录") {
  return NextResponse.json({ error }, { status: 401 })
}

export function serviceUnavailable(error = "服务暂时不可用") {
  return NextResponse.json({ error }, { status: 503 })
}

export function tooManyRequests(retryAfter?: number) {
  return NextResponse.json(
    { error: "请求过于频繁，请稍后再试" },
    {
      status: 429,
      ...(retryAfter ? { headers: { "Retry-After": String(retryAfter) } } : {}),
    },
  )
}

export async function withDatabaseUnavailableFallback<T>(
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await handler()
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return serviceUnavailable(DATABASE_UNAVAILABLE_RESPONSE_MESSAGE)
    }
    throw error
  }
}

export function csrfToken(): string {
  return randomUUID()
}

export function setSessionCookies(response: NextResponse, token: string) {
  const secure = secureCookies()
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  response.cookies.set(CSRF_COOKIE_NAME, csrfToken(), {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export function clearSessionCookies(response: NextResponse) {
  const secure = secureCookies()
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  response.cookies.set(CSRF_COOKIE_NAME, "", {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

function trustedOrigins(request: NextRequest): Set<string> {
  const values = [
    process.env.APP_ORIGIN,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VEIL_ALLOWED_ORIGINS,
  ]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean)

  const host = request.headers.get("host")
  if (host && process.env.NODE_ENV !== "production") {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    const protocol = forwardedProto || "http"
    values.push(`${protocol}://${host}`)
  }

  return new Set(
    values.flatMap((value) => {
      try {
        const url = new URL(value)
        return [url.origin]
      } catch {
        return []
      }
    }),
  )
}

export function ensureTrustedOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin")
  if (origin) {
    try {
      if (!trustedOrigins(request).has(new URL(origin).origin)) {
        return NextResponse.json({ error: "请求来源无效" }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: "请求来源无效" }, { status: 403 })
    }
  }
  return null
}

export function ensureCsrf(request: NextRequest): NextResponse | null {
  const auth = request.headers.get("authorization")
  if (auth?.startsWith("Bearer ") && isLocalDesktopToken(auth.slice(7))) {
    return null
  }

  const originError = ensureTrustedOrigin(request)
  if (originError) return originError

  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value
  const headerToken = request.headers.get("x-csrf-token")
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return NextResponse.json({ error: "CSRF 校验失败" }, { status: 403 })
  }
  return null
}

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ data: T } | { response: NextResponse }> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { response: badRequest("请求体必须是有效 JSON") }
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return { response: badRequest(validationErrorMessage(parsed.error)) }
  }

  return { data: parsed.data }
}
