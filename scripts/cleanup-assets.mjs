import fs from "node:fs/promises"
import path from "node:path"
import { Pool } from "pg"

function databaseSsl() {
  const value = (process.env.DATABASE_SSL || process.env.PGSSLMODE || "").trim().toLowerCase()
  if (!value || value === "disable" || value === "false" || value === "0") return undefined
  if (value === "strict" || value === "verify-full") return true
  return { rejectUnauthorized: false }
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

function positiveInteger(value, fallback, label) {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed >= 0) return parsed
  console.error(`[assets:cleanup] ${label} must be a non-negative integer`)
  process.exit(1)
}

function uploadRoot() {
  return path.resolve(process.env.VEIL_UPLOAD_DIR?.trim() || path.join(process.cwd(), "uploads"))
}

function resolveStoragePath(root, storagePath) {
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(resolvedRoot, storagePath)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Invalid asset storage path: ${storagePath}`)
  }
  return resolvedPath
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("[assets:cleanup] DATABASE_URL is required")
  process.exit(1)
}

const execute = process.argv.includes("--execute")
const graceDays = positiveInteger(
  optionValue("--grace-days", process.env.VEIL_ORPHAN_ASSET_GRACE_DAYS ?? "7"),
  7,
  "grace days",
)
const limit = positiveInteger(optionValue("--limit", "500"), 500, "limit")
const root = uploadRoot()

const pool = new Pool({
  connectionString,
  max: 1,
  ssl: databaseSsl(),
})

try {
  const candidates = await pool.query(
    `
      SELECT a.id, a.user_id, a.storage_path, a.size_bytes, a.created_at
      FROM assets a
      WHERE a.created_at < NOW() - ($1::int * INTERVAL '1 day')
        AND NOT EXISTS (
          SELECT 1
          FROM notes n
          WHERE n.user_id = a.user_id
            AND n.blocks::text LIKE '%' || '/api/assets/' || a.id || '%'
          LIMIT 1
        )
      ORDER BY a.created_at ASC
      LIMIT $2
    `,
    [graceDays, limit],
  )

  if (!execute) {
    console.log(`[assets:cleanup] dry-run candidates=${candidates.rowCount ?? 0} graceDays=${graceDays}`)
    for (const row of candidates.rows) {
      console.log(`[assets:cleanup] candidate id=${row.id} bytes=${row.size_bytes} path=${row.storage_path}`)
    }
    console.log("[assets:cleanup] pass --execute to delete candidates")
    process.exit(0)
  }

  let deleted = 0
  let deletedBytes = 0
  for (const row of candidates.rows) {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const current = await client.query(
        `
          DELETE FROM assets a
          WHERE a.id = $1
            AND NOT EXISTS (
              SELECT 1
              FROM notes n
              WHERE n.user_id = a.user_id
                AND n.blocks::text LIKE '%' || '/api/assets/' || a.id || '%'
              LIMIT 1
            )
          RETURNING a.storage_path, a.size_bytes
        `,
        [row.id],
      )
      const deletedRow = current.rows[0]
      if (deletedRow) {
        const absolutePath = resolveStoragePath(root, deletedRow.storage_path)
        await fs.unlink(absolutePath).catch((error) => {
          if (error?.code !== "ENOENT") throw error
        })
        deleted++
        deletedBytes += Number(deletedRow.size_bytes)
      }
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {})
      console.error(`[assets:cleanup] failed id=${row.id}`)
      console.error(error)
    } finally {
      client.release()
    }
  }

  console.log(`[assets:cleanup] deleted=${deleted} bytes=${deletedBytes}`)
} finally {
  await pool.end()
}
