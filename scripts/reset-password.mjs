import crypto from "node:crypto"
import { promisify } from "node:util"
import { Pool } from "pg"

const scryptAsync = promisify(crypto.scrypt)

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function databaseSsl() {
  const value = (process.env.DATABASE_SSL || process.env.PGSSLMODE || "").trim().toLowerCase()
  if (!value || value === "disable" || value === "false" || value === "0") return undefined
  if (value === "strict" || value === "verify-full") return true
  return { rejectUnauthorized: false }
}

const username = (argValue("--username") || process.env.VEIL_RESET_USERNAME || "").trim()
const password = argValue("--password") || process.env.VEIL_RESET_PASSWORD || ""

if (!process.env.DATABASE_URL) {
  console.error("[password:reset] DATABASE_URL is required")
  process.exit(1)
}
if (username.length < 2 || username.length > 50) {
  console.error("[password:reset] username must be 2-50 characters")
  process.exit(1)
}
if (password.length < 12 || password.length > 128) {
  console.error("[password:reset] password must be 12-128 characters")
  process.exit(1)
}

const salt = crypto.randomBytes(16).toString("hex")
const passwordHash = (await scryptAsync(password, salt, 64)).toString("hex")

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: databaseSsl(),
})

const client = await pool.connect()
try {
  await client.query("BEGIN")
  const user = await client.query(
    "SELECT id, username FROM users WHERE lower(username) = lower($1) LIMIT 1 FOR UPDATE",
    [username],
  )
  const row = user.rows[0]
  if (!row) {
    console.error(`[password:reset] user not found: ${username}`)
    await client.query("ROLLBACK")
    process.exitCode = 1
  } else {
    await client.query(
      "UPDATE users SET password_hash = $1, salt = $2, token = NULL, token_expires_at = NULL WHERE id = $3",
      [passwordHash, salt, row.id],
    )
    const sessions = await client.query(
      "UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1 AND revoked_at IS NULL",
      [row.id],
    )
    await client.query(
      `
        INSERT INTO auth_events (user_id, username, event_type, success, ip_address, user_agent)
        VALUES ($1, $2, 'password_admin_reset', TRUE, '', 'scripts/reset-password.mjs')
      `,
      [row.id, row.username],
    )
    await client.query("COMMIT")
    console.log(`[password:reset] reset password for ${row.username}; revoked ${sessions.rowCount ?? 0} sessions`)
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  console.error("[password:reset] failed")
  console.error(error)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
