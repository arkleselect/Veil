"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Copy, ExternalLink, FileIcon, ImageIcon, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { ConfirmDialog } from "@/components/dialog"
import { useToast } from "@/components/toast-provider"
import { ApiError, deleteAsset, getAssets } from "@/lib/api"
import type { Asset, AssetUsage } from "@/lib/assets-data"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function absoluteAssetUrl(asset: Asset): string {
  if (typeof window === "undefined") return asset.url
  return new URL(asset.url, window.location.origin).href
}

function isImageAsset(asset: Asset): boolean {
  return asset.contentType.startsWith("image/")
}

export function AssetManager() {
  const { toast } = useToast()
  const [assets, setAssets] = useState<Asset[]>([])
  const [usage, setUsage] = useState<AssetUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const usagePercent = useMemo(() => {
    if (!usage || usage.quotaBytes <= 0) return 0
    return Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100)
  }, [usage])

  const loadAssets = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    try {
      const result = await getAssets(100)
      setAssets(result.items)
      setUsage(result.usage)
    } catch {
      toast("加载文件存储失败", "error")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [toast])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  const handleCopy = async (asset: Asset) => {
    try {
      await navigator.clipboard.writeText(absoluteAssetUrl(asset))
      toast("已复制文件链接", "success")
    } catch {
      toast("复制文件链接失败", "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeletingId(target.id)
    try {
      await deleteAsset(target.id)
      setAssets((prev) => prev.filter((asset) => asset.id !== target.id))
      setUsage((prev) => prev
        ? {
            ...prev,
            usedBytes: Math.max(0, prev.usedBytes - target.sizeBytes),
            assetCount: Math.max(0, prev.assetCount - 1),
          }
        : prev)
      toast("已删除文件", "success")
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "删除文件失败", "error")
    } finally {
      setDeletingId(null)
      setDeleteTarget(null)
    }
  }

  return (
    <section className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">文件存储</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {usage
              ? `${formatBytes(usage.usedBytes)} / ${formatBytes(usage.quotaBytes)} · ${usage.assetCount} 个`
              : "正在加载"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAssets(true)}
          disabled={loading || refreshing}
          aria-label="刷新文件存储"
          title="刷新"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      <div className="px-4 pb-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>

      <div className="border-t border-border">
        {loading ? (
          <div className="flex h-28 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : assets.length === 0 ? (
          <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
            暂无文件
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {assets.map((asset) => (
              <li key={asset.id} className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted bg-cover bg-center text-muted-foreground"
                  style={isImageAsset(asset) ? { backgroundImage: `url(${asset.url})` } : undefined}
                >
                  {isImageAsset(asset) ? <ImageIcon className="h-4 w-4" /> : <FileIcon className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{asset.filename}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {asset.contentType} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.createdAt)} · {asset.referenceCount > 0 ? `${asset.referenceCount} 篇引用` : "未引用"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleCopy(asset)}
                    aria-label="复制文件链接"
                    title="复制链接"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}
                    aria-label="打开文件"
                    title="打开"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(asset)}
                    disabled={deletingId === asset.id || asset.referenceCount > 0}
                    aria-label={asset.referenceCount > 0 ? "文件已被引用，不能删除" : "删除文件"}
                    title={asset.referenceCount > 0 ? "先移除笔记引用后再删除" : "删除"}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingId === asset.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="删除文件"
        message={`确定删除「${deleteTarget?.filename ?? ""}」？`}
        confirmText="删除"
        destructive
      />
    </section>
  )
}
