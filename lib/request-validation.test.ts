import { describe, expect, it } from "vitest"
import { changePasswordSchema, registerSchema } from "@/lib/request-validation"

describe("request-validation", () => {
  it("requires production-grade password length for registration", () => {
    expect(registerSchema.safeParse({
      username: "alice",
      password: "short123",
    }).success).toBe(false)

    expect(registerSchema.safeParse({
      username: "alice",
      password: "long-enough1",
    }).success).toBe(true)
  })

  it("validates password change input", () => {
    expect(changePasswordSchema.safeParse({
      currentPassword: "old-password",
      newPassword: "old-password",
    }).success).toBe(false)

    expect(changePasswordSchema.safeParse({
      currentPassword: "old-password",
      newPassword: "new-password1",
    }).success).toBe(true)
  })
})
