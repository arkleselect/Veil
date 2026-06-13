const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  runtime: "electron",
  getLocalVaultPath: () => ipcRenderer.invoke("vault:getPath"),
  selectLocalVaultFolder: () => ipcRenderer.invoke("vault:selectFolder"),
})
