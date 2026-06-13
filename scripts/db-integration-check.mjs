import crypto from "node:crypto"
import { Pool } from "pg"

function databaseSsl() {
  const value = (process.env.DATABASE_SSL || process.env.PGSSLMODE || "").trim().toLowerCase()
  if (!value || value === "disable" || value === "false" || value === "0") return undefined
  if (value === "strict" || value === "verify-full") return true
  return { rejectUnauthorized: false }
}

if (!process.env.DATABASE_URL) {
  console.error("[db-check] DATABASE_URL is required")
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: databaseSsl(),
})

const suffix = crypto.randomUUID()
const userId = `db-check-user-${suffix}`
const noteId = `db-check-note-${suffix}`
const assetId = `db-check-asset-${suffix}`

try {
  await step("schema migrations", async (client) => {
    const expected = [
      "001_initial_schema",
      "002_indexes",
      "003_note_versioning",
      "004_note_pagination_indexes",
      "005_assets",
      "006_user_sessions_and_auth_events",
      "007_rate_limit_buckets",
      "008_notes_search_index",
    ]
    const result = await client.query(
      "SELECT id FROM schema_migrations WHERE id = ANY($1::text[])",
      [expected],
    )
    if ((result.rowCount ?? 0) < expected.length) {
      throw new Error(`expected ${expected.length} migrations, got ${result.rowCount ?? 0}`)
    }
  })

  await step("required tables", async (client) => {
    const result = await client.query(`
      SELECT
        to_regclass('public.users')::text AS users,
        to_regclass('public.notes')::text AS notes,
        to_regclass('public.assets')::text AS assets,
        to_regclass('public.user_sessions')::text AS user_sessions,
        to_regclass('public.auth_events')::text AS auth_events,
        to_regclass('public.rate_limit_buckets')::text AS rate_limit_buckets
    `)
    for (const [name, value] of Object.entries(result.rows[0])) {
      if (!value) throw new Error(`missing table ${name}`)
    }
  })

  await step("write paths", async (client) => {
    await client.query("BEGIN")
    await client.query(
      "INSERT INTO users (id, username, password_hash, salt) VALUES ($1, $2, 'hash', 'salt')",
      [userId, `db-check-${suffix}`],
    )
    await client.query(
      `
        INSERT INTO notes (
          id, user_id, title, excerpt, notebook, notebook_icon, note_date,
          starred, tags, blocks, version, content_hash
        )
        VALUES ($1, $2, 'Searchable launch note', 'launch excerpt', '默认笔记本', 'BookOpen', '2026-06-09',
          FALSE, '["db-check"]'::jsonb, '[{"type":"paragraph","text":"full text search body"}]'::jsonb, 1, 'hash')
      `,
      [noteId, userId],
    )
    await client.query(
      `
        INSERT INTO assets (id, user_id, filename, content_type, size_bytes, storage_path)
        VALUES ($1, $2, 'check.txt', 'text/plain', 4, $3)
      `,
      [assetId, userId, `${userId}/check.txt`],
    )
    await client.query(
      `
        INSERT INTO rate_limit_buckets (bucket_key, count, reset_at)
        VALUES ($1, 1, NOW() + INTERVAL '1 minute')
        ON CONFLICT (bucket_key) DO UPDATE SET count = rate_limit_buckets.count + 1
      `,
      [`db-check:${suffix}`],
    )
    await client.query(
      `
        INSERT INTO auth_events (user_id, username, event_type, success)
        VALUES ($1, $2, 'db_check', TRUE)
      `,
      [userId, `db-check-${suffix}`],
    )

    const search = await client.query(
      `
        SELECT id
        FROM notes
        WHERE user_id = $1
          AND search_vector @@ websearch_to_tsquery('simple', $2)
      `,
      [userId, "launch body"],
    )
    if (search.rows[0]?.id !== noteId) {
      throw new Error("notes full-text search did not return inserted note")
    }

    await client.query("ROLLBACK")
  })

  console.log("[db-check] ok")
} catch (error) {
  console.error(`[db-check] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await pool.end()
}

async function step(name, fn) {
  process.stdout.write(`[db-check] ${name}... `)
  const client = await pool.connect()
  try {
    await fn(client)
    process.stdout.write("ok\n")
  } finally {
    client.release()
  }
}
