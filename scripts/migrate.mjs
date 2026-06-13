import { Pool } from "pg"

function databaseSsl() {
  const value = (process.env.DATABASE_SSL || process.env.PGSSLMODE || "").trim().toLowerCase()
  if (!value || value === "disable" || value === "false" || value === "0") return undefined
  if (value === "strict" || value === "verify-full") return true
  return { rejectUnauthorized: false }
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("[migrate] DATABASE_URL is required")
  process.exit(1)
}

const migrations = [
  {
    id: "001_initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        token TEXT UNIQUE,
        token_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notebooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'BookOpen',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, name)
      );

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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS sync_changes (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL,
        action TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    id: "002_indexes",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));
      CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notes_user_deleted ON notes(user_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_notes_user_notebook ON notes(user_id, notebook);
      CREATE INDEX IF NOT EXISTS idx_notes_user_starred ON notes(user_id, starred) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);
      CREATE INDEX IF NOT EXISTS idx_sync_changes_user_updated ON sync_changes(user_id, updated_at DESC);
    `,
  },
  {
    id: "003_note_versioning",
    sql: `
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_notes_user_version ON notes(user_id, version);
    `,
  },
  {
    id: "004_note_pagination_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_notes_user_updated_id
        ON notes(user_id, updated_at DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notes_tags_gin ON notes USING GIN(tags);
    `,
  },
  {
    id: "005_assets",
    sql: `
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, storage_path)
      );
      CREATE INDEX IF NOT EXISTS idx_assets_user_created ON assets(user_id, created_at DESC);
    `,
  },
  {
    id: "006_user_sessions_and_auth_events",
    sql: `
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
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_created
        ON user_sessions(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_active
        ON user_sessions(user_id, expires_at)
        WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS auth_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        username TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_auth_events_user_created
        ON auth_events(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_auth_events_event_created
        ON auth_events(event_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_auth_events_username_created
        ON auth_events(lower(username), created_at DESC);
    `,
  },
  {
    id: "007_rate_limit_buckets",
    sql: `
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        bucket_key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at
        ON rate_limit_buckets(reset_at);
    `,
  },
  {
    id: "008_notes_search_index",
    sql: `
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
        ) STORED;

      CREATE INDEX IF NOT EXISTS idx_notes_search_vector
        ON notes USING GIN(search_vector);
      CREATE INDEX IF NOT EXISTS idx_notes_title_trgm
        ON notes USING GIN(title gin_trgm_ops)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notes_excerpt_trgm
        ON notes USING GIN(excerpt gin_trgm_ops)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notes_notebook_trgm
        ON notes USING GIN(notebook gin_trgm_ops)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notes_tags_text_trgm
        ON notes USING GIN((tags::text) gin_trgm_ops)
        WHERE deleted_at IS NULL;
    `,
  },
  {
    id: "009_note_parent_tree",
    sql: `
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS parent_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_notes_user_parent
        ON notes(user_id, parent_id)
        WHERE deleted_at IS NULL;
    `,
  },
]

const pool = new Pool({
  connectionString,
  max: 1,
  ssl: databaseSsl(),
})

const client = await pool.connect()
try {
  await client.query("SELECT pg_advisory_lock(8675309)")
  await client.query("BEGIN")
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const migration of migrations) {
    const existing = await client.query("SELECT id FROM schema_migrations WHERE id = $1", [migration.id])
    if ((existing.rowCount ?? 0) > 0) {
      console.log(`[migrate] skip ${migration.id}`)
      continue
    }

    console.log(`[migrate] apply ${migration.id}`)
    await client.query(migration.sql)
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id])
  }

  await client.query("COMMIT")
  console.log("[migrate] ok")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  console.error("[migrate] failed")
  console.error(error)
  process.exitCode = 1
} finally {
  await client.query("SELECT pg_advisory_unlock(8675309)").catch(() => {})
  client.release()
  await pool.end()
}
