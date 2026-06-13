const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron")
const fs = require("node:fs")
const http = require("node:http")
const path = require("node:path")

const isDev = !app.isPackaged
let mainWindow
let serverStarted = false

function isReloadShortcut(input) {
  const key = input.key?.toLowerCase()
  return key === "f5" || ((input.control || input.meta) && key === "r")
}

function defaultVaultPath() {
  return path.join(app.getPath("documents"), "Veil Notes")
}

function settingsPath() {
  if (process.env.VEIL_LOCAL_VAULT_SETTINGS_PATH) {
    return process.env.VEIL_LOCAL_VAULT_SETTINGS_PATH
  }
  return path.join(app.getPath("userData"), "settings.json")
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf-8"))
  } catch {
    return {}
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf-8")
}

function getLocalVaultPath() {
  return process.env.VEIL_LOCAL_VAULT_PATH || readSettings().localVaultPath || defaultVaultPath()
}

function setLocalVaultPath(vaultPath) {
  const settings = readSettings()
  writeSettings({ ...settings, localVaultPath: vaultPath })
  process.env.VEIL_LOCAL_VAULT_PATH = vaultPath
}

function registerIpcHandlers() {
  ipcMain.handle("vault:getPath", () => getLocalVaultPath())
  ipcMain.handle("vault:selectFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择本地笔记仓库",
      defaultPath: getLocalVaultPath(),
      properties: ["openDirectory", "createDirectory"],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const selectedPath = result.filePaths[0]
    setLocalVaultPath(selectedPath)
    return selectedPath
  })
}

function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve()
      })

      req.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Next server did not start within ${timeoutMs}ms`))
          return
        }
        setTimeout(check, 250)
      })

      req.setTimeout(1000, () => {
        req.destroy()
      })
    }

    check()
  })
}

async function startPackagedNextServer() {
  if (serverStarted) return
  serverStarted = true

  const port = process.env.PORT || "32145"
  process.env.PORT = port
  process.env.HOSTNAME = "127.0.0.1"
  process.env.NEXT_PUBLIC_APP_RUNTIME = "desktop"
  process.env.VEIL_DESKTOP_RUNTIME = "1"
  process.env.VEIL_LOCAL_VAULT_SETTINGS_PATH = settingsPath()
  process.env.VEIL_LOCAL_VAULT_PATH = getLocalVaultPath()

  const appPath = app.getAppPath()
  const packagedRoot = appPath.endsWith(".asar")
    ? path.join(process.resourcesPath, "app.asar.unpacked")
    : appPath
  const standaloneDir = path.join(packagedRoot, ".next", "standalone")
  process.chdir(standaloneDir)
  require(path.join(standaloneDir, "server.js"))

  await waitForServer(`http://127.0.0.1:${port}`)
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: "",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#0b0b0b",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (isReloadShortcut(input)) {
      event.preventDefault()
    }
  })

  if (isDev) {
    process.env.NEXT_PUBLIC_APP_RUNTIME = "desktop"
    process.env.VEIL_DESKTOP_RUNTIME = "1"
    process.env.VEIL_LOCAL_VAULT_SETTINGS_PATH = settingsPath()
    process.env.VEIL_LOCAL_VAULT_PATH = getLocalVaultPath()
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL || "http://localhost:3000")
    mainWindow.webContents.openDevTools({ mode: "detach" })
    return
  }

  await startPackagedNextServer()
  await mainWindow.loadURL(`http://127.0.0.1:${process.env.PORT}`)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpcHandlers()
  createWindow()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
