"use client"

import { useState } from "react"
import {
  HardDrive,
  Cloud,
  LogOut,
  Search,
  FileText,
  Calendar,
  Sparkles,
  Star,
  Plus,
  Tags,
  LayoutTemplate,
  Trash2,
  Settings,
  BookOpen,
  Briefcase,
  Library,
  Lightbulb,
  Plane,
  ChevronLeft,
  PenLine,
  X,
  MoreHorizontal,
  Check,
} from "lucide-react"
import { DEFAULT_NOTEBOOK_NAME, type Notebook, type Note, type WorkspaceMode } from "@/lib/notes-data"
import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { cn } from "@/lib/utils"

const notebookIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  BookOpen,
  Briefcase,
  Library,
  Lightbulb,
  Plane,
}

const notebookIconOptions = [
  { id: "BookOpen", label: "默认", icon: BookOpen },
  { id: "Briefcase", label: "工作", icon: Briefcase },
  { id: "Library", label: "资料", icon: Library },
  { id: "Lightbulb", label: "灵感", icon: Lightbulb },
  { id: "Plane", label: "旅行", icon: Plane },
]

interface SidebarProps {
  mode: WorkspaceMode
  activeNav: string
  onNavChange: (id: string) => void
  onSwitchMode: () => void
  localRepositoryAvailable?: boolean
  onToggleSidebar?: () => void
  notebooks: Notebook[]
  favorites: Note[]
  onLogout?: () => void
  onSetView: (view: string) => void
  onCreateNotebook: (name: string) => void
  onRenameNotebook: (id: string, name: string) => void
  onUpdateNotebookIcon: (id: string, icon: string) => void | Promise<void>
  onDeleteNotebook: (id: string, name: string) => boolean | Promise<boolean>
}

export function Sidebar({ mode, activeNav, onNavChange, onSwitchMode, localRepositoryAvailable = true, onToggleSidebar, notebooks, favorites, onLogout, onSetView, onCreateNotebook, onRenameNotebook, onUpdateNotebookIcon, onDeleteNotebook }: SidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; count: number } | null>(null)
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)
  const [iconPickerId, setIconPickerId] = useState<string | null>(null)

  const handleStartRename = (id: string, currentName: string) => {
    setActionMenuId(null)
    setIconPickerId(null)
    setRenamingId(id)
    setRenameDraft(currentName)
  }

  const handleFinishRename = async () => {
    if (!renamingId || !renameDraft.trim()) {
      setRenamingId(null)
      return
    }
    await onRenameNotebook(renamingId, renameDraft.trim())
    setRenamingId(null)
  }

  const handleDeleteNotebook = (notebook: Notebook) => {
    if (notebook.name === DEFAULT_NOTEBOOK_NAME && notebook.count > 0) {
      setDeleteTarget(null)
      return
    }
    setDeleteTarget({ id: notebook.id, name: notebook.name, count: notebook.count })
  }

  const handleUpdateNotebookIcon = async (id: string, icon: string) => {
    setIconPickerId(null)
    await onUpdateNotebookIcon(id, icon)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return false
    const target = deleteTarget
    const deleted = await onDeleteNotebook(target.id, target.name)
    if (!deleted) return false
    if (activeNav === `nb-${target.id}`) onNavChange("all")
    setDeleteTarget(null)
    return true
  }

  const handleNavMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button === 1) event.preventDefault()
  }

  return (
    <aside className="app-drag-region flex h-full flex-col border-r border-border bg-sidebar">
      {/* 顶部：仓库标题 */}
      <div className="app-drag-region desktop-window-control-spacer flex h-14 items-center gap-2 px-4">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-foreground">
          我的笔记
        </div>
        <button type="button" onClick={onToggleSidebar} aria-label="收起侧栏" className="app-no-drag ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <nav onMouseDown={handleNavMouseDown} className="scrollbar-hidden flex-1 overflow-y-auto px-3 pb-4">
        {/* 主导航 */}
        <ul className="flex flex-col gap-0.5">
          <NavItem icon={Search} label="搜索" id="search" active={activeNav === "search"} onClick={onNavChange} muted />
          <NavItem icon={FileText} label="全部笔记" id="all" active={activeNav === "all"} onClick={onNavChange} />
          <NavItem icon={Calendar} label="今天" id="today" active={activeNav === "today"} onClick={onNavChange} />
          <NavItem icon={Sparkles} label="AI 助手" id="ai" active={activeNav === "ai"} onClick={onNavChange} />
        </ul>

        {/* 收藏 */}
        <SectionLabel>收藏</SectionLabel>
        <ul className="flex flex-col gap-0.5">
          {favorites.length === 0 && (
            <li className="app-no-drag px-2.5 py-1.5 text-xs text-muted-foreground">暂无收藏</li>
          )}
          {favorites.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onNavChange(f.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-sm transition-colors outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                  activeNav === f.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent",
                )}
              >
                <Star className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{f.title}</span>
              </button>
            </li>
          ))}
        </ul>

        {/* 笔记本 */}
        <SectionLabel>笔记本</SectionLabel>
        <ul className="flex flex-col gap-0.5">
          {notebooks.length === 0 && (
            <li className="app-no-drag px-2.5 py-1.5 text-xs text-muted-foreground">暂无笔记本</li>
          )}
          {notebooks.map((nb) => {
            const Icon = notebookIcons[nb.icon] ?? FileText
            const isRenaming = renamingId === nb.id
            return (
              <li key={nb.id} className="app-no-drag relative">
                <div
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm transition-colors outline-none focus-within:outline-none focus-within:ring-0",
                    activeNav === `nb-${nb.id}`
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent",
                  )}
                >
                  {isRenaming ? (
                    <>
                      <Icon className="ml-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={handleFinishRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishRename()
                          if (e.key === "Escape") setRenamingId(null)
                        }}
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                      />
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setActionMenuId(null)
                          setIconPickerId((current) => (current === nb.id ? null : nb.id))
                        }}
                        aria-label="更换笔记本图标"
                        title="更换图标"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavChange(`nb-${nb.id}`)}
                        className="min-w-0 flex-1 truncate text-left outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                      >
                        <span className="truncate">{nb.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setIconPickerId(null)
                          setActionMenuId((current) => (current === nb.id ? null : nb.id))
                        }}
                        aria-label="笔记本操作"
                        title="更多"
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 group-hover:opacity-100",
                          actionMenuId === nb.id && "opacity-100",
                        )}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
                {iconPickerId === nb.id && (
                  <div
                    onMouseDown={(event) => event.stopPropagation()}
                    className="absolute left-2 top-8 z-20 grid grid-cols-5 gap-1 rounded-[8px] border border-border bg-popover p-1 shadow-lg"
                  >
                    {notebookIconOptions.map((option) => {
                      const OptionIcon = option.icon
                      const active = nb.icon === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => void handleUpdateNotebookIcon(nb.id, option.id)}
                          aria-label={`更换为${option.label}图标`}
                          title={option.label}
                          className={cn(
                            "relative flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0",
                            active && "text-sidebar-foreground",
                          )}
                        >
                          <OptionIcon className="h-4 w-4" />
                          {active && <Check className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5" />}
                        </button>
                      )
                    })}
                  </div>
                )}
                {actionMenuId === nb.id && !isRenaming && (
                  <div
                    onMouseDown={(event) => event.stopPropagation()}
                    className="absolute right-2 top-8 z-20 w-28 rounded-[8px] border border-border bg-popover p-1 text-sm shadow-lg"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenuId(null)
                        handleStartRename(nb.id, nb.name)
                      }}
                      className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-popover-foreground transition-colors hover:bg-sidebar-accent"
                    >
                      <PenLine className="h-3.5 w-3.5" />
                      重命名
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenuId(null)
                        handleDeleteNotebook(nb)
                      }}
                      disabled={nb.name === DEFAULT_NOTEBOOK_NAME && nb.count > 0}
                      title={nb.name === DEFAULT_NOTEBOOK_NAME && nb.count > 0 ? "默认笔记本为空时才能删除" : "删除笔记本"}
                      className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-destructive transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <X className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                )}
              </li>
            )
          })}
          <li>
            <button
              type="button"
              onClick={() => setCreateDialogOpen(true)}
              className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-sidebar-accent focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            >
              <Plus className="h-4 w-4 shrink-0" />
              新建笔记本
            </button>
          </li>
        </ul>
      </nav>

      <div className="app-no-drag shrink-0 border-t border-border px-3 py-3">
        <ul className="flex flex-col gap-0.5">
          <NavItem icon={Tags} label="标签管理" id="tags" active={activeNav === "tags"} onClick={onNavChange} />
          <NavItem icon={LayoutTemplate} label="模板中心" id="templates" active={activeNav === "templates"} onClick={onNavChange} />
          <NavItem icon={Trash2} label="回收站" id="trash" active={activeNav === "trash"} onClick={onNavChange} />
        </ul>
      </div>

      {/* 仓库 + 设置 */}
      <div className="app-no-drag border-t border-border px-3 py-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onSwitchMode}
              disabled={!localRepositoryAvailable && mode !== "local"}
              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              aria-label={mode === "local" ? "本地仓库" : "云端同步"}
              title={localRepositoryAvailable ? (mode === "local" ? "本地仓库" : "云端同步") : "本地仓库仅桌面端可用"}
            >
              {mode === "local" ? <HardDrive className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => onSetView("settings")}
              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label="设置"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="退出登录"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <PromptDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={(name) => onCreateNotebook(name)}
        title="新建笔记本"
        placeholder="输入笔记本名称"
        submitText="创建"
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="删除笔记本"
        message={deleteTarget?.name === DEFAULT_NOTEBOOK_NAME
          ? `确定删除空的默认笔记本「${deleteTarget.name}」？`
          : `确定删除笔记本「${deleteTarget?.name ?? ""}」？笔记会移动到默认笔记本，不会被删除。`}
        confirmText="删除"
        destructive
      />
    </aside>
  )
}

function NavItem({
  icon: Icon,
  label,
  id,
  active,
  onClick,
  muted,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  id: string
  active: boolean
  onClick: (id: string) => void
  muted?: boolean
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onClick(id)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-sm transition-colors outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : muted
              ? "text-muted-foreground hover:bg-sidebar-accent"
              : "text-sidebar-foreground/90 hover:bg-sidebar-accent",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </button>
    </li>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="app-no-drag mb-1 mt-5 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}
