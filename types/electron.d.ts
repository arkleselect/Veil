export {}

declare global {
  interface Window {
    electronAPI?: {
      runtime: "electron"
      getLocalVaultPath?: () => Promise<string>
      selectLocalVaultFolder?: () => Promise<string | null>
    }
  }
}
