"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"
import { ConfirmDialog } from "@/components/dialog"
import { useToast } from "@/components/toast-provider"
import {
  ApiError,
  getAuthSessions,
  revokeAuthSession,
  revokeOtherAuthSessions,
  type AuthSession,
} from "@/lib/api"

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function deviceLabel(userAgent: string): string {
  const value = userAgent.toLowerCase()
  if (!value) return "未知设备"

  const browser = value.includes("edg/")
    ? "Edge"
    : value.includes("chrome/")
      ? "Chrome"
      : value.includes("firefox/")
        ? "Firefox"
        : value.includes("safari/")
          ? "Safari"
          : "浏览器"

  const platform = value.includes("iphone") || value.includes("ipad")
    ? "iOS"
    : value.includes("android")
      ? "Android"
      : value.includes("mac os x")
        ? "macOS"
        : value.includes("windows")
          ? "Windows"
          : value.includes("linux")
            ? "Linux"
            : "设备"

  return `${platform} · ${browser}`
}

export function SessionManager() {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<AuthSession[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<AuthSession | null>(null)
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false)

  const otherSessionCount = useMemo(
    () => sessions.filter((session) => !session.current).length,
    [sessions],
  )

  const loadSessions = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    try {
      setSessions(await getAuthSessions())
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "加载登录设备失败", "error")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [toast])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const handleRevoke = async () => {
    if (!revokeTarget) return
    const target = revokeTarget
    setRevokingId(target.id)
    try {
      await revokeAuthSession(target.id)
      setSessions((prev) => prev.filter((session) => session.id !== target.id))
      toast("已撤销会话", "success")
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "撤销会话失败", "error")
    } finally {
      setRevokingId(null)
      setRevokeTarget(null)
    }
  }

  const handleRevokeOthers = async () => {
    setRevokingId("others")
    try {
      const result = await revokeOtherAuthSessions()
      setSessions((prev) => prev.filter((session) => session.current))
      toast(`已撤销 ${result.revoked} 个会话`, "success")
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "撤销其他会话失败", "error")
    } finally {
      setRevokingId(null)
      setRevokeOthersOpen(false)
    }
  }

  return (
    <section className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">登录设备</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {loading ? "正在加载" : `${sessions.length} 个活动会话`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void loadSessions(true)}
            disabled={loading || refreshing}
            aria-label="刷新登录设备"
            title="刷新"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setRevokeOthersOpen(true)}
            disabled={otherSessionCount === 0 || revokingId === "others"}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {revokingId === "others" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            撤销其他
          </button>
        </div>
      </div>

      <div className="border-t border-border">
        {loading ? (
          <div className="flex h-28 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            暂无活动会话
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {sessions.map((session) => (
              <li key={session.id} className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                  <MonitorSmartphone className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{deviceLabel(session.userAgent)}</p>
                    {session.current && (
                      <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                        当前
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    最近活动 {formatDate(session.lastSeenAt)}
                    {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    创建于 {formatDate(session.createdAt)} · 到期 {formatDate(session.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRevokeTarget(session)}
                  disabled={session.current || revokingId === session.id}
                  aria-label={session.current ? "当前会话不能撤销" : "撤销会话"}
                  title={session.current ? "当前会话" : "撤销"}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {revokingId === session.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title="撤销会话"
        message={`确定撤销「${revokeTarget ? deviceLabel(revokeTarget.userAgent) : ""}」？`}
        confirmText="撤销"
        destructive
      />
      <ConfirmDialog
        open={revokeOthersOpen}
        onClose={() => setRevokeOthersOpen(false)}
        onConfirm={handleRevokeOthers}
        title="撤销其他会话"
        message={`确定撤销其他 ${otherSessionCount} 个会话？`}
        confirmText="撤销"
        destructive
      />
    </section>
  )
}
