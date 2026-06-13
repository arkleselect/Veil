const { spawn, spawnSync } = require("node:child_process")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")

const port = process.env.PORT || "3000"
const url = process.env.ELECTRON_RENDERER_URL || `http://localhost:${port}`
const children = []

function run(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...env },
  })
  children.push(child)
  return child
}

function waitForServer(targetUrl, timeoutMs = 30000) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(targetUrl, (res) => {
        res.resume()
        resolve()
      })

      req.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Dev server did not start within ${timeoutMs}ms: ${targetUrl}`))
          return
        }
        setTimeout(check, 300)
      })

      req.setTimeout(1000, () => {
        req.destroy()
      })
    }

    check()
  })
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM")
  }
}

process.on("SIGINT", () => {
  shutdown()
  process.exit(0)
})
process.on("SIGTERM", () => {
  shutdown()
  process.exit(0)
})

async function main() {
  const vaultSettingsPath = path.join(os.homedir(), ".veil-notes-dev-settings.json")
  const desktopEnv = {
    NEXT_PUBLIC_APP_RUNTIME: "desktop",
    VEIL_DESKTOP_RUNTIME: "1",
    VEIL_LOCAL_VAULT_SETTINGS_PATH: vaultSettingsPath,
    ...(process.env.VEIL_LOCAL_VAULT_PATH ? { VEIL_LOCAL_VAULT_PATH: process.env.VEIL_LOCAL_VAULT_PATH } : {}),
  }

  const rebuild = spawnSync("pnpm", ["rebuild", "better-sqlite3"], {
    stdio: "inherit",
    shell: false,
    env: process.env,
  })
  if (rebuild.status !== 0) {
    process.exit(rebuild.status || 1)
  }

  const next = run("pnpm", ["run", "dev"], { PORT: port, ...desktopEnv })
  next.on("exit", (code) => {
    if (code !== 0) process.exit(code || 1)
  })

  await waitForServer(url)

  const electron = run("pnpm", ["exec", "electron", "."], {
    ELECTRON_RENDERER_URL: url,
    ...desktopEnv,
  })
  electron.on("exit", () => {
    shutdown()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error(error)
  shutdown()
  process.exit(1)
})
