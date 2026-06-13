const baseUrl = normalizeBaseUrl(process.env.VEIL_SMOKE_BASE_URL || process.env.SMOKE_BASE_URL)
const username = process.env.VEIL_SMOKE_USERNAME || process.env.SMOKE_USERNAME
const password = process.env.VEIL_SMOKE_PASSWORD || process.env.SMOKE_PASSWORD
const trustedOrigin = normalizeOrigin(process.env.VEIL_SMOKE_ORIGIN || process.env.SMOKE_ORIGIN || baseUrl)
const skipUpload = isEnabled(process.env.VEIL_SMOKE_SKIP_UPLOAD)
const restoreNoteAfterDelete = isEnabled(process.env.VEIL_SMOKE_RESTORE_NOTE)

if (!baseUrl || !username || !password) {
  console.error("[smoke] required env: VEIL_SMOKE_BASE_URL, VEIL_SMOKE_USERNAME, VEIL_SMOKE_PASSWORD")
  process.exit(1)
}

const cookies = new Map()
let createdNote = null
let uploadedAsset = null

try {
  await step("login page", async () => {
    const response = await request("GET", "/login")
    assertStatus(response, 200)
  })

  await step("health", async () => {
    const response = await request("GET", "/api/health")
    assertStatus(response, 200)
  })

  await step("sessions require auth", async () => {
    const response = await request("GET", "/api/auth/sessions")
    assertStatus(response, 401)
  })

  await step("login", async () => {
    const response = await request("POST", "/api/auth/login", {
      json: { username, password },
      includeOrigin: true,
    })
    assertStatus(response, 200)
    const body = await response.json()
    if (!body.id || body.username !== username) {
      throw new Error("login response did not include the expected user")
    }
    if (!cookies.get("veil_session") || !cookies.get("veil_csrf")) {
      throw new Error("login did not set session and csrf cookies")
    }
  })

  await step("missing csrf is rejected", async () => {
    const response = await request("DELETE", "/api/auth/sessions?scope=others", {
      includeCookies: true,
      includeOrigin: true,
    })
    assertStatus(response, 403)
  })

  await step("me", async () => {
    const response = await request("GET", "/api/auth/me", { includeCookies: true })
    assertStatus(response, 200)
    const body = await response.json()
    if (body.username !== username) {
      throw new Error("me response did not include the expected username")
    }
  })

  await step("sessions", async () => {
    const response = await request("GET", "/api/auth/sessions", { includeCookies: true })
    assertStatus(response, 200)
    const body = await response.json()
    if (!Array.isArray(body.sessions) || !body.sessions.some((session) => session.current)) {
      throw new Error("sessions response did not include the current session")
    }
  })

  await step("revoke other sessions", async () => {
    const response = await request("DELETE", "/api/auth/sessions?scope=others", {
      includeCookies: true,
      includeCsrf: true,
      includeOrigin: true,
    })
    assertStatus(response, 200)
    const body = await response.json()
    if (!Number.isInteger(body.revoked) || body.revoked < 0) {
      throw new Error("revoke other sessions response is invalid")
    }
  })

  await step("create note", async () => {
    const title = `Veil smoke ${new Date().toISOString()}`
    const response = await request("POST", "/api/notes", {
      includeCookies: true,
      includeCsrf: true,
      includeOrigin: true,
      json: {
        title,
        tags: ["smoke"],
        blocks: [{ type: "paragraph", text: "Cloud smoke note body" }],
      },
    })
    assertStatus(response, 201)
    createdNote = await response.json()
    if (!createdNote.id || !createdNote.version) {
      throw new Error("create note response is invalid")
    }
  })

  await step("update note", async () => {
    const response = await request("PUT", `/api/notes?id=${encodeURIComponent(createdNote.id)}`, {
      includeCookies: true,
      includeCsrf: true,
      includeOrigin: true,
      json: {
        title: `${createdNote.title} updated`,
        blocks: [{ type: "paragraph", text: "Cloud smoke note body updated" }],
        baseVersion: createdNote.version,
      },
    })
    assertStatus(response, 200)
    createdNote = await response.json()
    if (createdNote.title.endsWith("updated") !== true) {
      throw new Error("update note response did not include the updated title")
    }
  })

  await step("read note", async () => {
    const response = await request("GET", `/api/notes?id=${encodeURIComponent(createdNote.id)}`, {
      includeCookies: true,
    })
    assertStatus(response, 200)
    const body = await response.json()
    if (body.id !== createdNote.id) {
      throw new Error("read note returned the wrong note")
    }
  })

  if (!skipUpload) {
    await step("upload image", async () => {
      const form = new FormData()
      form.set("file", new File([smokePngBytes()], "smoke.png", { type: "image/png" }))
      const response = await request("POST", "/api/assets", {
        includeCookies: true,
        includeCsrf: true,
        includeOrigin: true,
        form,
      })
      assertStatus(response, 201)
      uploadedAsset = await response.json()
      if (!uploadedAsset.id || uploadedAsset.contentType !== "image/png") {
        throw new Error("upload image response is invalid")
      }
    })

    await step("list assets", async () => {
      const response = await request("GET", "/api/assets?limit=20", { includeCookies: true })
      assertStatus(response, 200)
      const body = await response.json()
      if (!Array.isArray(body.items) || !body.items.some((asset) => asset.id === uploadedAsset.id)) {
        throw new Error("uploaded asset was not returned by asset list")
      }
    })

    await step("delete image", async () => {
      const response = await request("DELETE", `/api/assets/${encodeURIComponent(uploadedAsset.id)}`, {
        includeCookies: true,
        includeCsrf: true,
        includeOrigin: true,
      })
      assertStatus(response, 200)
      uploadedAsset = null
    })
  }

  await step("delete note", async () => {
    const response = await request(
      "DELETE",
      `/api/notes?id=${encodeURIComponent(createdNote.id)}&baseVersion=${createdNote.version}`,
      {
        includeCookies: true,
        includeCsrf: true,
        includeOrigin: true,
      },
    )
    assertStatus(response, 200)
  })

  if (restoreNoteAfterDelete) {
    await step("restore note", async () => {
      const trash = await request("GET", "/api/notes?type=trash", { includeCookies: true })
      assertStatus(trash, 200)
      const trashNotes = await trash.json()
      const deleted = trashNotes.find((note) => note.id === createdNote.id)
      if (!deleted) throw new Error("deleted smoke note was not found in trash")

      const response = await request(
        "POST",
        `/api/notes?action=restore&id=${encodeURIComponent(deleted.id)}&baseVersion=${deleted.version}`,
        {
          includeCookies: true,
          includeCsrf: true,
          includeOrigin: true,
        },
      )
      assertStatus(response, 200)
      createdNote = await response.json()
    })
  }

  await step("logout", async () => {
    const response = await request("POST", "/api/auth/logout", {
      includeCookies: true,
      includeCsrf: true,
      includeOrigin: true,
    })
    assertStatus(response, 200)
  })

  console.log("[smoke] ok")
} catch (error) {
  console.error(`[smoke] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}

async function step(name, fn) {
  process.stdout.write(`[smoke] ${name}... `)
  await fn()
  process.stdout.write("ok\n")
}

async function request(method, path, options = {}) {
  const headers = new Headers()
  headers.set("Accept", "application/json, text/html")

  if (options.includeOrigin) {
    headers.set("Origin", trustedOrigin)
  }
  if (options.includeCookies) {
    headers.set("Cookie", cookieHeader())
  }
  if (options.includeCsrf) {
    const token = cookies.get("veil_csrf")
    if (!token) throw new Error("missing csrf cookie")
    headers.set("X-CSRF-Token", token)
  }

  let body
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(options.json)
  } else if (options.form) {
    body = options.form
  }

  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body,
    redirect: "manual",
  })
  storeCookies(response.headers)
  return response
}

function assertStatus(response, expected) {
  if (response.status !== expected) {
    throw new Error(`expected HTTP ${expected}, got ${response.status}`)
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
}

function storeCookies(headers) {
  for (const line of setCookieLines(headers)) {
    const first = line.split(";")[0]
    const index = first.indexOf("=")
    if (index <= 0) continue
    const name = first.slice(0, index)
    const value = first.slice(index + 1)
    if (!value) cookies.delete(name)
    else cookies.set(name, value)
  }
}

function setCookieLines(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie()
  const combined = headers.get("set-cookie")
  if (!combined) return []
  return combined.split(/,\s*(?=[^,;=]+=[^,;]*)/g)
}

function normalizeBaseUrl(value) {
  if (!value) return ""
  const url = new URL(value)
  url.hash = ""
  url.search = ""
  return url.href.replace(/\/$/, "")
}

function normalizeOrigin(value) {
  if (!value) return ""
  return new URL(value).origin
}

function isEnabled(value) {
  return value === "1" || value?.toLowerCase() === "true"
}

function smokePngBytes() {
  return Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ))
}
