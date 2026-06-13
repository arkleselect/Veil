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

const username = (argValue("--username") || process.env.VEIL_ADMIN_USERNAME || "").trim()
const password = argValue("--password") || process.env.VEIL_ADMIN_PASSWORD || ""

if (!process.env.DATABASE_URL) {
  console.error("[user:create] DATABASE_URL is required")
  process.exit(1)
}
if (username.length < 2 || username.length > 50) {
  console.error("[user:create] username must be 2-50 characters")
  process.exit(1)
}
if (password.length < 12 || password.length > 128) {
  console.error("[user:create] password must be 12-128 characters")
  process.exit(1)
}

const salt = crypto.randomBytes(16).toString("hex")
const passwordHash = (await scryptAsync(password, salt, 64)).toString("hex")

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: databaseSsl(),
})

try {
  const existing = await pool.query(
    "SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1",
    [username],
  )
  if ((existing.rowCount ?? 0) > 0) {
    console.error(`[user:create] user already exists: ${username}`)
    process.exitCode = 1
  } else {
    await pool.query(
      `
        INSERT INTO users (id, username, password_hash, salt)
        VALUES ($1, $2, $3, $4)
      `,
      [crypto.randomUUID(), username, passwordHash, salt],
    )
    console.log(`[user:create] created user: ${username}`)
  }
} finally {
  await pool.end()
}
