export type ShareLinkResult = "shared" | "copied" | "cancelled"

interface ShareLinkInput {
  title: string
  text?: string
  url: string
}

export function noteShareUrl(noteId: string): string {
  const url = new URL("/", window.location.origin)
  url.searchParams.set("note", noteId)
  return url.toString()
}

export function notebookShareUrl(notebookId?: string): string {
  const url = new URL("/", window.location.origin)
  url.searchParams.set("view", "home")
  if (notebookId) url.searchParams.set("notebook", notebookId)
  return url.toString()
}

export async function shareOrCopyLink(input: ShareLinkInput): Promise<ShareLinkResult> {
  if (navigator.share) {
    try {
      await navigator.share(input)
      return "shared"
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
    }
  }

  await copyText(input.url)
  return "copied"
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall through to the selection-based copy path for non-secure HTTP deployments.
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  if (!copied) throw new Error("Copy failed")
}
