import { z } from "zod";

/**
 * Auth input schemas (AUTH_REDESIGN §4.2, §5). Client-safe: no server imports.
 *
 * Password policy: at least 10 characters, at most 72 UTF-8 bytes (bcrypt only uses the first 72 bytes, so longer
 * passwords are rejected rather than silently truncated). No composition rules.
 */

export const PASSWORD_MIN_CHARS = 10;
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_TOO_SHORT_MESSAGE = `Use at least ${PASSWORD_MIN_CHARS} characters`;
export const PASSWORD_TOO_LONG_MESSAGE = "Use at most 72 bytes; some symbols count as more than one";
export const PASSWORDS_DO_NOT_MATCH_MESSAGE = "Passwords do not match";

const utf8 = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return utf8.encode(value).length;
}

/** Counts Unicode code points, so an emoji or a Devanagari letter counts as one character. */
function charCount(value: string): number {
  return Array.from(value).length;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .max(254, "Enter a valid email address")
  .email("Enter a valid email address");

/** A new password (reset now; set-password and change-password later). */
export const newPasswordSchema = z
  .string()
  .refine((v) => charCount(v) >= PASSWORD_MIN_CHARS, PASSWORD_TOO_SHORT_MESSAGE)
  .refine((v) => utf8ByteLength(v) <= PASSWORD_MAX_BYTES, PASSWORD_TOO_LONG_MESSAGE);

/** Sign-in only checks presence: the server decides whether the password is right. */
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

export const recoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from the email");

export const resetRequestSchema = z.object({
  email: emailSchema,
});

export const completeResetSchema = z.object({
  email: emailSchema,
  code: recoveryCodeSchema,
  newPassword: newPasswordSchema,
});

/** The forgot-password form adds a confirmation field. */
export const completeResetFormSchema = completeResetSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: PASSWORDS_DO_NOT_MATCH_MESSAGE,
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type CompleteResetInput = z.infer<typeof completeResetSchema>;
