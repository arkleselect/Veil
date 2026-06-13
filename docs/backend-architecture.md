# Veil Notes Backend Architecture

This document describes the current implementation, not the earlier MVP plan.

## Runtime Modes

```txt
Browser cloud mode
  components/workspace.tsx
    -> lib/api.ts
      -> app/api/*
        -> lib/notes-store.ts
          -> PostgreSQL
        -> lib/assets-store.ts
          -> PostgreSQL assets table + VEIL_UPLOAD_DIR

Desktop local mode
  components/workspace.tsx
    -> lib/api.ts with local desktop token
      -> app/api/*
        -> lib/notes-store.ts
          -> lib/local-vault-store.ts
            -> Markdown files + .veil/index.sqlite
```

Cloud and desktop use the same HTTP API surface. The server switches storage based on the authenticated user id: normal users use PostgreSQL, and the desktop token maps to the local vault user.

## Implemented

- PostgreSQL persistence for users, notebooks, notes, trash, and sync metadata.
- Idempotent schema setup in `lib/db.ts` and explicit migrations in `scripts/migrate.mjs`.
- Production readiness checks through `GET /api/health`.
- Cookie-based auth, multi-session login records, CSRF validation, trusted Origin checks, production registration gating, account lockout, and PostgreSQL-backed source/account scoped auth rate limiting.
- Auth event logging for registration, login, and password-change outcomes.
- Administrator password reset through `pnpm run password:reset`, with old session revocation and auth event logging.
- Database integration checks through `pnpm run db:check`.
- Session management through `GET /api/auth/sessions` and `DELETE /api/auth/sessions`, used by the settings page to list and revoke other logged-in devices.
- Request tracing with `X-Request-Id` and structured JSON access logs.
- Local vault storage using Markdown note files and a SQLite index.
- Note sanitization for rich-text blocks before persistence.
- Note `version` and `contentHash` metadata across cloud, local vault, Markdown, and sync payloads.
- Optimistic concurrency control using `baseVersion`; stale writes return HTTP 409 with the current server note.
- Workspace saves create a conflict copy when a stale write conflicts and the local attempted edit can be preserved.
- Notebook rename/delete updates affected note versions and recalculates `contentHash` in the same transaction.
- Paginated note listing through `GET /api/notes?page=true`, with cursor-based ordering by `updatedAt/id`.
- Server-side list filters for search text, notebook, tag, note date, and starred notes. Cloud search uses a generated `search_vector` GIN index with trigram fallback indexes.
- Server-side tag aggregation through `GET /api/notes?type=tags`.
- Authenticated image and file upload through `POST /api/assets`; files are served through `GET /api/assets/[id]`.
- Asset listing and usage through `GET /api/assets`; deletion through `DELETE /api/assets/[id]`.
- The settings page exposes file storage usage, link copy, preview/download, and deletion controls.
- Per-user file quota through `VEIL_ASSET_QUOTA_BYTES`; uploads are serialized per user with a PostgreSQL advisory lock before insert.
- Cloud files are stored under `VEIL_UPLOAD_DIR`; desktop files are stored in the local vault `assets/` directory.
- Orphaned cloud files can be reviewed or deleted with `pnpm run assets:cleanup`.
- `/api/sync` push/pull with conflict detection by `baseVersion`, fallback `updatedAt`, and optional `contentHash`.

## Key Data Flow

### Cloud Note Update

```txt
Workspace handleUpdateNote
  -> updateNote(id, { ..., baseVersion: current.version })
    -> PUT /api/notes?id=...
      -> updateNote(userId, id, input)
        -> UPDATE notes ... WHERE user_id = ? AND id = ? AND version = ?
```

If the row update misses because another request already changed the note, the server reloads the current note and returns:

```json
{
  "error": "笔记已被其他设备更新",
  "current": { "...": "latest note" }
}
```

The frontend merges the current note into local state, reloads data, and shows a conflict notification.

### Sync

Push items can include:

```json
{
  "id": "note-id",
  "markdown": "...",
  "updatedAt": "2026-06-09T00:00:00.000Z",
  "baseVersion": 3,
  "version": 4,
  "contentHash": "sha256..."
}
```

Pull items include `version`, `contentHash`, `deleted`, `updatedAt`, and Markdown. The returned `contentHash` is calculated from the returned Markdown payload so a client can safely echo it on the next push.

### Note List Pagination

The main workspace loads notes with:

```txt
GET /api/notes?page=true&limit=50
GET /api/notes?page=true&q=keyword&cursor=...
GET /api/notes?page=true&notebook=notebook-id
GET /api/notes?page=true&tag=tag-name
GET /api/notes?page=true&date=today
GET /api/notes?page=true&starred=true
```

The response shape is:

```json
{
  "items": [],
  "hasMore": true,
  "nextCursor": "opaque-cursor"
}
```

Older callers that omit `page=true` still receive the legacy note array response.

## Database Shape

```txt
users
  id
  username
  password_hash
  salt
  token              # legacy compatibility only
  token_expires_at  # legacy compatibility only
  created_at

user_sessions
  id
  user_id
  token_hash
  created_at
  last_seen_at
  expires_at
  revoked_at
  ip_address
  user_agent

auth_events
  id
  user_id
  username
  event_type
  success
  ip_address
  user_agent
  created_at

rate_limit_buckets
  bucket_key
  count
  reset_at
  updated_at

notebooks
  id
  user_id
  name
  icon
  created_at

notes
  id
  user_id
  title
  excerpt
  notebook
  notebook_icon
  note_date
  starred
  tags
  blocks
  version
  content_hash
  search_vector
  created_at
  updated_at
  deleted_at

sync_changes
  id
  user_id
  note_id
  action
  updated_at

assets
  id
  user_id
  filename
  content_type
  size_bytes
  storage_path
  created_at

schema_migrations
  id
  applied_at
```

## Remaining Backend Risks

- Sync conflict handling detects conflicts; normal editor saves preserve a conflict copy, but there is not yet a visual merge UI.
- The local development environment used for this review did not include PostgreSQL or Docker, so real migration execution must still be run on a server or CI database.
- Admin recovery is script-based; there is not yet an in-app administrator console or audit dashboard.
