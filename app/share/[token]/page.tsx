import { PublicNotePage } from "@/components/public-note-page"

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params
  return <PublicNotePage token={token} />
}
