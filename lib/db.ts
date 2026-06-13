import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg"

let pool: Pool | null = null
let schemaReady = false
const DATABASE_URL_MISSING_MESSAGE = "DATABASE_URL 未配置。云端模式需要 PostgreSQL 数据库。"

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(DATABASE_URL_MISSING_MESSAGE)
  }
  return url
}

function databaseSsl(): PoolConfig["ssl"] {
  const value = (process.env.DATABASE_SSL || process.env.PGSSLMODE || "").trim().toLowerCase()
  if (!value || value === "disable" || value === "false" || value === "0") return undefined
  if (value === "strict" || value === "verify-full") return true
  return { rejectUnauthorized: false }
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message === DATABASE_URL_MISSING_MESSAGE) return true

  const code = (error as { code?: unknown }).code
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03"
  )
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      ssl: databaseSsl(),
    })
  }
  return pool
}

export async function ensureSchema() {
  if (schemaReady) return

  const client = await getPool().connect()
  try {
    await client.query("BEGIN")
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        token TEXT UNIQUE,
        token_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS notebooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'BookOpen',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, name)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL DEFAULT '',
        notebook TEXT NOT NULL,
        notebook_icon TEXT NOT NULL DEFAULT 'BookOpen',
        note_date TEXT NOT NULL,
        starred BOOLEAN NOT NULL DEFAULT FALSE,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        content_hash TEXT NOT NULL DEFAULT '',
        sort_order DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `)
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_changes (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL,
        action TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, storage_path)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT ''
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        username TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        bucket_key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_user_updated_id ON notes(user_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_user_deleted ON notes(user_id, deleted_at)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_user_notebook ON notes(user_id, notebook)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_user_starred ON notes(user_id, starred) WHERE deleted_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_tags_gin ON notes USING GIN(tags)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_assets_user_created ON assets(user_id, created_at DESC)")
    await client.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1")
    await client.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS parent_id TEXT")
    await client.query("ALTER TABLE notes ADD COLUMN IF NOT EXISTS sort_order DOUBLE PRECISION")
    await client.query(`
      ALTER TABLE notes
        ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
          to_tsvector(
            'simple',
            coalesce(title, '') || ' ' ||
            coalesce(excerpt, '') || ' ' ||
            coalesce(notebook, '') || ' ' ||
            coalesce(tags::text, '') || ' ' ||
            coalesce(blocks::text, '')
          )
        ) STORED
    `)
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_user_version ON notes(user_id, version)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_user_parent ON notes(user_id, parent_id) WHERE deleted_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_user_sort_order ON notes(user_id, sort_order DESC, id DESC) WHERE deleted_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_search_vector ON notes USING GIN(search_vector)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_title_trgm ON notes USING GIN(title gin_trgm_ops) WHERE deleted_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_excerpt_trgm ON notes USING GIN(excerpt gin_trgm_ops) WHERE deleted_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_notebook_trgm ON notes USING GIN(notebook gin_trgm_ops) WHERE deleted_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notes_tags_text_trgm ON notes USING GIN((tags::text) gin_trgm_ops) WHERE deleted_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_sync_changes_user_updated ON sync_changes(user_id, updated_at DESC)")
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username))")
    await client.query("CREATE INDEX IF NOT EXISTS idx_user_sessions_user_created ON user_sessions(user_id, created_at DESC)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, expires_at) WHERE revoked_at IS NULL")
    await client.query("CREATE INDEX IF NOT EXISTS idx_auth_events_user_created ON auth_events(user_id, created_at DESC)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_auth_events_event_created ON auth_events(event_type, created_at DESC)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_auth_events_username_created ON auth_events(lower(username), created_at DESC)")
    await client.query("CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at ON rate_limit_buckets(reset_at)")
    await client.query("COMMIT")
    schemaReady = true
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  await ensureSchema()
  return getPool().query<T>(sql, values)
}

export async function pingDatabase(): Promise<void> {
  await getPool().query("SELECT 1")
}

export async function checkDatabaseReadiness(): Promise<void> {
  await pingDatabase()
  const result = await getPool().query<{
    schema_migrations: string | null
    users: string | null
    notebooks: string | null
    notes: string | null
    sync_changes: string | null
    assets: string | null
    user_sessions: string | null
    auth_events: string | null
    rate_limit_buckets: string | null
  }>(`
    SELECT
      to_regclass('public.schema_migrations')::text AS schema_migrations,
      to_regclass('public.users')::text AS users,
      to_regclass('public.notebooks')::text AS notebooks,
      to_regclass('public.notes')::text AS notes,
      to_regclass('public.sync_changes')::text AS sync_changes,
      to_regclass('public.assets')::text AS assets,
      to_regclass('public.user_sessions')::text AS user_sessions,
      to_regclass('public.auth_events')::text AS auth_events,
      to_regclass('public.rate_limit_buckets')::text AS rate_limit_buckets
  `)
  const row = result.rows[0]
  if (
    !row?.schema_migrations ||
    !row.users ||
    !row.notebooks ||
    !row.notes ||
    !row.sync_changes ||
    !row.assets ||
    !row.user_sessions ||
    !row.auth_events ||
    !row.rate_limit_buckets
  ) {
    throw new Error("Database schema is not migrated")
  }

  const migrations = await getPool().query<{ id: string }>(
    "SELECT id FROM schema_migrations WHERE id = ANY($1::text[])",
    [[
      "001_initial_schema",
      "002_indexes",
      "003_note_versioning",
      "004_note_pagination_indexes",
      "005_assets",
      "006_user_sessions_and_auth_events",
      "007_rate_limit_buckets",
      "008_notes_search_index",
      "009_note_parent_tree",
    ]],
  )
  if ((migrations.rowCount ?? 0) < 9) {
    throw new Error("Database schema is not migrated")
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema()
  const client = await getPool().connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
