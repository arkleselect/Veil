import fs from "fs"
import os from "os"
import path from "path"

export function getLocalVaultRoot(): string {
  const envPath = process.env.VEIL_LOCAL_VAULT_PATH?.trim()
  if (envPath) return envPath

  const settingsPath = process.env.VEIL_LOCAL_VAULT_SETTINGS_PATH?.trim()
  if (settingsPath) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as { localVaultPath?: unknown }
      if (typeof settings.localVaultPath === "string" && settings.localVaultPath.trim()) {
        return settings.localVaultPath
      }
    } catch {
      // Missing or malformed desktop settings should fall back to the default vault.
    }
  }

  return path.join(os.homedir(), "Documents", "Veil Notes")
}
