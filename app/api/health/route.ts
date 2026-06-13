import { NextResponse } from "next/server"
import { checkDatabaseReadiness, isDatabaseUnavailableError } from "@/lib/db"

export const runtime = "nodejs"

export async function GET() {
  try {
    await checkDatabaseReadiness()
    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    const message = isDatabaseUnavailableError(error)
      ? "database_unavailable"
      : "database_not_ready"

    return NextResponse.json(
      { status: "error", error: message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
}
