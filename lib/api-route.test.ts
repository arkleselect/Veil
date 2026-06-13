import { NextRequest } from "next/server"
import { afterEach, describe, expect, it } from "vitest"
import { ensureTrustedOrigin } from "@/lib/api-route"

describe("api-route", () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalAppOrigin = process.env.APP_ORIGIN

  function setNodeEnv(value: string | undefined) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV")
    } else {
      Reflect.set(process.env, "NODE_ENV", value)
    }
  }

  afterEach(() => {
    setNodeEnv(originalNodeEnv)
    if (originalAppOrigin === undefined) {
      delete process.env.APP_ORIGIN
    } else {
      process.env.APP_ORIGIN = originalAppOrigin
    }
  })

  it("does not trust the Host header as an origin in production", () => {
    setNodeEnv("production")
    process.env.APP_ORIGIN = "https://notes.example.com"

    const request = new NextRequest("https://evil.example/api/auth/login", {
      headers: {
        host: "evil.example",
        origin: "https://evil.example",
      },
    })

    expect(ensureTrustedOrigin(request)?.status).toBe(403)
  })

  it("allows the current Host origin outside production", () => {
    setNodeEnv("test")
    delete process.env.APP_ORIGIN

    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
    })

    expect(ensureTrustedOrigin(request)).toBeNull()
  })
})
