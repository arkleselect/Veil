import path from "node:path"

const required = ["DATABASE_URL"]

const errors = []
const warnings = []

for (const key of required) {
  if (!process.env[key]?.trim()) {
    errors.push(`${key} is required`)
  }
}

const poolSize = process.env.DATABASE_POOL_SIZE
if (poolSize && (!Number.isInteger(Number(poolSize)) || Number(poolSize) < 1)) {
  errors.push("DATABASE_POOL_SIZE must be a positive integer")
}

const maxUploadBytes = process.env.VEIL_MAX_UPLOAD_BYTES
if (maxUploadBytes && (!Number.isInteger(Number(maxUploadBytes)) || Number(maxUploadBytes) < 1)) {
  errors.push("VEIL_MAX_UPLOAD_BYTES must be a positive integer")
}

const assetQuotaBytes = process.env.VEIL_ASSET_QUOTA_BYTES
if (assetQuotaBytes && (!Number.isInteger(Number(assetQuotaBytes)) || Number(assetQuotaBytes) < 1)) {
  errors.push("VEIL_ASSET_QUOTA_BYTES must be a positive integer")
}

const orphanAssetGraceDays = process.env.VEIL_ORPHAN_ASSET_GRACE_DAYS
if (
  orphanAssetGraceDays &&
  (!Number.isInteger(Number(orphanAssetGraceDays)) || Number(orphanAssetGraceDays) < 0)
) {
  errors.push("VEIL_ORPHAN_ASSET_GRACE_DAYS must be a non-negative integer")
}

for (const name of [
  "VEIL_AUTH_LOCKOUT_FAILURES",
  "VEIL_AUTH_LOCKOUT_WINDOW_MINUTES",
  "VEIL_AUTH_LOCKOUT_DURATION_MINUTES",
]) {
  const value = process.env[name]
  if (value && (!Number.isInteger(Number(value)) || Number(value) < 1)) {
    errors.push(`${name} must be a positive integer`)
  }
}

const ssl = process.env.DATABASE_SSL || process.env.PGSSLMODE
if (ssl) {
  const allowed = new Set(["0", "1", "false", "true", "disable", "require", "strict", "verify-full"])
  if (!allowed.has(ssl.trim().toLowerCase())) {
    errors.push("DATABASE_SSL/PGSSLMODE must be one of disable, require, strict, verify-full, true, or false")
  }
}

function requireUrl(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    errors.push(`${name} is required`)
    return null
  }
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push(`${name} must use http or https`)
    }
    return url
  } catch {
    errors.push(`${name} must be a valid URL`)
    return null
  }
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}

function validateBoolean(name) {
  const value = process.env[name]
  if (value === undefined || value === "") return
  if (!["true", "false"].includes(value.trim().toLowerCase())) {
    errors.push(`${name} must be true or false`)
  }
}

validateBoolean("VEIL_ALLOW_REGISTRATION")
validateBoolean("VEIL_SEED_SAMPLE_NOTES")
validateBoolean("VEIL_ALLOW_INSECURE_HTTP")
validateBoolean("VEIL_COOKIE_SECURE")

if (process.env.NODE_ENV === "production") {
  const appOrigin = requireUrl("APP_ORIGIN")
  if (appOrigin) {
    if (appOrigin.pathname !== "/" || appOrigin.search || appOrigin.hash) {
      errors.push("APP_ORIGIN must be an origin only, for example https://notes.example.com")
    }
    if (
      appOrigin.protocol !== "https:" &&
      !isLoopbackHost(appOrigin.hostname) &&
      process.env.VEIL_ALLOW_INSECURE_HTTP !== "true"
    ) {
      errors.push("APP_ORIGIN must use https in production")
    }
  }

  const uploadDir = process.env.VEIL_UPLOAD_DIR?.trim()
  if (!uploadDir) {
    errors.push("VEIL_UPLOAD_DIR is required in production and must point to persistent storage")
  } else if (!path.isAbsolute(uploadDir)) {
    errors.push("VEIL_UPLOAD_DIR must be an absolute path in production")
  }

  if (process.env.VEIL_DESKTOP_RUNTIME === "1") {
    errors.push("VEIL_DESKTOP_RUNTIME must not be enabled on a cloud production server")
  }
  if (process.env.NEXT_PUBLIC_APP_RUNTIME === "desktop") {
    errors.push("NEXT_PUBLIC_APP_RUNTIME=desktop must not be used for cloud production")
  }
  if (process.env.VEIL_ALLOW_REGISTRATION !== "true") {
    warnings.push("VEIL_ALLOW_REGISTRATION is not true; new user registration will be disabled")
  }
}

for (const warning of warnings) {
  console.warn(`[env] warning: ${warning}`)
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[env] error: ${error}`)
  }
  process.exit(1)
}

console.log("[env] ok")
