"use client"

import { useEffect, useState } from "react"
import {
  FolderOpen,
  ChevronRight,
  HardDrive,
} from "lucide-react"
import type { WorkspaceMode } from "@/lib/notes-data"
import SideRays from "@/components/SideRays"
import "@/components/SideRays.css"

interface ModeSelectProps {
  onSelect: (mode: WorkspaceMode) => void
}

export function ModeSelect({ onSelect }: ModeSelectProps) {
  const [repositoryPath, setRepositoryPath] = useState("~/Documents/Veil Notes")
  const [selectingFolder, setSelectingFolder] = useState(false)
  const localAvailable = typeof window !== "undefined" && window.electronAPI?.runtime === "electron"

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getLocalVaultPath) return
    api.getLocalVaultPath()
      .then((path) => {
        if (path) setRepositoryPath(path)
      })
      .catch(() => {})
  }, [])

  const handleSelectFolder = async () => {
    const api = window.electronAPI
    if (!api?.selectLocalVaultFolder) return

    setSelectingFolder(true)
    try {
      const nextPath = await api.selectLocalVaultFolder()
      if (nextPath) setRepositoryPath(nextPath)
    } finally {
      setSelectingFolder(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div className="absolute inset-0 z-0">
        <SideRays
          speed={2.5}
          rayColor1="#eab308"
          rayColor2="#96c8ff"
          intensity={2}
          spread={2}
          origin="top-right"
          tilt={0}
          saturation={1.5}
          blend={0.75}
          falloff={1.6}
          opacity={1}
        />
      </div>
      <div className="absolute inset-0 z-[1] bg-background/60 backdrop-blur-xl" />
      <div className="relative z-10 w-full max-w-lg">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <FolderOpen className="h-6 w-6" />
          </div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
            选择本地笔记仓库
          </h1>
          <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
            {localAvailable
              ? "选择一个本地文件夹，桌面端会把笔记以文件形式保存在你的设备上。"
              : "本地仓库需要桌面端能力，云端浏览器请继续使用云端笔记。"}
          </p>
        </header>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <HardDrive className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-foreground">本地仓库</h2>
              <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Local Repository
              </p>
              <p className="mt-2.5 text-pretty text-sm leading-relaxed text-muted-foreground">
                {localAvailable
                  ? "数据保存在本地文件夹中，适合桌面端离线使用和文件级备份。"
                  : "当前浏览器环境无法读取本地文件夹。"}
              </p>
            </div>
          </div>

          <div className="mt-5 flex h-12 items-center gap-3 rounded-xl border border-border bg-background/40 px-3.5">
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-sm text-muted-foreground">
              {repositoryPath}
            </span>
            <button
              type="button"
              onClick={handleSelectFolder}
              disabled={!localAvailable || selectingFolder}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectingFolder ? "选择中..." : "更换文件夹"}
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            if (localAvailable) onSelect("local")
          }}
          disabled={!localAvailable}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {localAvailable ? "打开本地仓库" : "仅桌面端可用"}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </main>
  )
}
