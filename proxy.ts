import { NextResponse, type NextRequest } from "next/server"

const SKIP_PATH_PREFIXES = [
  "/_next/static",
  "/_next/image",
  "/favicon.ico",
  "/icon",
  "/apple-icon",
  "/placeholder",
]

function shouldLog(pathname: string): boolean {
  return !SKIP_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function requestId(request: NextRequest): string {
  return request.headers.get("x-request-id") || crypto.randomUUID()
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    ""
  ).slice(0, 160)
}

export function proxy(request: NextRequest) {
  const startedAt = Date.now()
  const id = requestId(request)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-request-id", id)
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  response.headers.set("X-Request-Id", id)

  if (shouldLog(request.nextUrl.pathname)) {
    console.log(JSON.stringify({
      level: "info",
      event: "http_request_start",
      requestId: id,
      method: request.method,
      path: request.nextUrl.pathname,
      durationMs: Date.now() - startedAt,
      ip: clientIp(request),
      userAgent: (request.headers.get("user-agent") || "").slice(0, 300),
    }))
  }

  return response
}
