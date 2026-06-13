"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { register } from "@/lib/api"
import { FolderOpen, ChevronRight } from "lucide-react"
import Link from "next/link"
import SideRays from "@/components/SideRays"
import "@/components/SideRays.css"

export default function RegisterPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password !== confirm) {
      setError("两次密码不一致")
      return
    }
    setLoading(true)
    try {
      const res = await register(username, password)
      localStorage.setItem("username", res.username)
      router.replace("/")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "注册失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-6">
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
      <div className="relative z-10 w-full max-w-sm">
        <div className="mx-auto mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <FolderOpen className="h-6 w-6" />
        </div>
        <h1 className="mb-2 text-center text-2xl font-semibold text-foreground">注册</h1>
        <p className="mb-8 text-center text-sm text-muted-foreground">创建一个新账号</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="确认密码"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "注册中..." : "注册"}
            <ChevronRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          已有账号？{" "}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            登录
          </Link>
        </p>
      </div>
    </main>
  )
}
