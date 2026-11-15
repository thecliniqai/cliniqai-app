import crypto from "crypto";
import { UserRole } from "@/lib/db/types";

export interface InviteTokenPayload {
  rawToken: string;
  tokenHash: string;
  expiresAt: string;
}

/**
 * Generates a cryptographically random invite token, its SHA-256 hash, and expiry.
 * The raw token is sent in the link/OTP to the user; only the hash is stored in the database.
 */
export function generateInviteToken(expiresInDays = 7): InviteTokenPayload {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashInviteToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  return {
    rawToken,
    tokenHash,
    expiresAt,
  };
}

/**
 * SHA-256 hash of an invite token.
 */
export function hashInviteToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

const RAW_INVITE_TOKEN = /^[0-9a-f]{64}$/;

/**
 * V2-05 05-07b: the SHA-256 of a well-formed raw invitation token (64 hex characters, as `invitation_issue_token`
 * mints them), else null. Every caller hashes through this, so a malformed token never reaches the database.
 */
export function inviteTokenHash(rawToken: unknown): string | null {
  if (typeof rawToken !== "string") return null;
  const token = rawToken.trim();
  return RAW_INVITE_TOKEN.test(token) ? hashInviteToken(token) : null;
}

export function buildJoinUrl(baseUrl: string, rawToken: string, email: string): string {
  const url = new URL("/join", baseUrl);
  url.searchParams.set("token", rawToken);
  url.searchParams.set("email", email);
  return url.toString();
}
