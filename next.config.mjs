import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'
const allowInsecureHttp = process.env.VEIL_ALLOW_INSECURE_HTTP === 'true'
const enforceHttps = process.env.VEIL_ENFORCE_HTTPS === 'true' && !allowInsecureHttp

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  turbopack: {
    root,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ]

    if (isProduction) {
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://*.vercel-insights.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ]
      if (enforceHttps) {
        csp.push('upgrade-insecure-requests')
      }
      securityHeaders.push(
        {
          key: 'Content-Security-Policy',
          value: csp.join('; '),
        },
      )
      if (enforceHttps) {
        securityHeaders.push({
          key: 'Strict-Transport-Security',
          value: 'max-age=31536000; includeSubDomains',
        })
      }
    }

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
