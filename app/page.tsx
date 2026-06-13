"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import type { WorkspaceMode } from "@/lib/notes-data"
import { getMe } from "@/lib/api"

const ModeSelect = dynamic(() => import("@/components/mode-select").then((m) => m.ModeSelect), { ssr: false })
const Workspace = dynamic(() => import("@/components/workspace").then((m) => m.Workspace), { ssr: false })

function isDesktopRuntime() {
  if (typeof window === "undefined") return false

  const runtimeWindow = window as typeof window & {
    __TAURI__?: unknown
    electronAPI?: unknown
  }

  return Boolean(
    runtimeWindow.__TAURI__ ||
      runtimeWindow.electronAPI,
  )
}

export default function Page() {
  const router = useRouter()
  const [mode, setMode] = useState<WorkspaceMode | null>(null)
  const [checking, setChecking] = useState(true)

  const handleModeSelect = (nextMode: WorkspaceMode) => {
    if (nextMode === "local" && !isDesktopRuntime()) return
    localStorage.setItem("workspaceMode", nextMode)
    setMode(nextMode)
  }

  useEffect(() => {
    if (isDesktopRuntime()) {
      document.documentElement.classList.add("desktop-shell")
      localStorage.removeItem("token")
      localStorage.setItem("username", "本地仓库")
      const savedMode = localStorage.getItem("workspaceMode")
      if (savedMode === "local") {
        setMode("local")
      }
      setChecking(false)
      return
    }

    document.documentElement.classList.remove("desktop-shell")
    getMe()
      .then(() => {
        if (!isDesktopRuntime()) {
          setMode("cloud")
        }
        setChecking(false)
      })
      .catch(() => {
        localStorage.removeItem("token")
        setChecking(false)
        const next = `${window.location.pathname}${window.location.search}${window.location.hash}`
        router.replace(`/login?next=${encodeURIComponent(next)}`)
      })
  }, [router])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    )
  }

  if (!mode) {
    return <ModeSelect onSelect={handleModeSelect} />
  }

  return (
    <Workspace
      mode={mode}
      onSwitchMode={() => {
        localStorage.removeItem("workspaceMode")
        setMode(null)
      }}
    />
  )
}
