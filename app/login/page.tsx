"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getMe, login } from "@/lib/api"
import { FolderOpen, ChevronRight, Eye, EyeOff } from "lucide-react"
import Link from "next/link"
import SideRays from "@/components/SideRays"
import "@/components/SideRays.css"

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const nextPath = safeNextPath(searchParams.get("next"))

  useEffect(() => {
    let active = true
    getMe()
      .then(() => {
        if (active) router.replace(nextPath)
      })
      .catch(() => {
        // Unauthenticated users should stay on the login form.
      })
    return () => {
      active = false
    }
  }, [nextPath, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await login(username, password)
      localStorage.setItem("username", res.username)
      router.replace(nextPath)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "登录失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6">
      <div className="absolute inset-0 z-0">
        <SideRays
          speed={2.5}
          rayColor1="#f4b82f"
          rayColor2="#5fb7ff"
          intensity={3.8}
          spread={2.25}
          origin="top-right"
          tilt={-4}
          saturation={1.8}
          blend={0.82}
          falloff={1.35}
          opacity={1}
        />
      </div>
      <div className="absolute inset-0 z-[1] bg-[radial-gradient(circle_at_92%_10%,rgba(95,183,255,0.32),rgba(244,184,47,0.10)_24%,transparent_52%)] dark:opacity-50" />
      <div className="absolute inset-0 z-[2] bg-background/35 backdrop-blur-lg dark:bg-background/60 dark:backdrop-blur-xl" />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mx-auto mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <FolderOpen className="h-6 w-6" />
        </div>
        <h1 className="mb-2 text-center text-2xl font-semibold text-foreground">登录</h1>
        <p className="mb-8 text-center text-sm text-muted-foreground">登录以访问你的云端笔记</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              className="w-full rounded-[8px] border border-[#e5e8e6] bg-[#f4f5f4] px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:border-border dark:bg-card"
            />
          </div>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              className="w-full rounded-[8px] border border-[#e5e8e6] bg-[#f4f5f4] px-4 py-3 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:border-border dark:bg-card"
            />
            <button
              type="button"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "登录中..." : "登录"}
            <ChevronRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          没有账号？{" "}
          <Link href="/register" className="font-medium text-foreground hover:underline">
            注册
          </Link>
        </p>
      </div>
    </main>
  )
}

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/"
  return value
}
