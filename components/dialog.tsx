"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button type="button" onClick={onClose} aria-label="关闭" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => boolean | void | Promise<boolean | void>
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = "确定", cancelText = "取消", destructive }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted-foreground mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3.5 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={async () => {
            const shouldClose = await onConfirm()
            if (shouldClose !== false) onClose()
          }}
          className={cn(
            "rounded-lg px-3.5 py-1.5 text-sm text-white transition-opacity hover:opacity-90",
            destructive ? "bg-destructive" : "bg-primary text-primary-foreground",
          )}
        >
          {confirmText}
        </button>
      </div>
    </Dialog>
  )
}

interface PromptDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (value: string) => void | Promise<void>
  title: string
  placeholder?: string
  defaultValue?: string
  submitText?: string
}

export function PromptDialog({ open, onClose, onSubmit, title, placeholder, defaultValue = "", submitText = "确定" }: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open, defaultValue])

  const handleSubmit = async () => {
    if (value.trim()) {
      await onSubmit(value.trim())
      onClose()
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mb-4"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3.5 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="rounded-lg bg-primary px-3.5 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
        >
          {submitText}
        </button>
      </div>
    </Dialog>
  )
}
