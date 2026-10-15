import fs from "fs";
import path from "path";

export interface DevAuthEvent {
  type: "STAFF_INVITATION" | "LOGIN_OTP" | "JOIN_OTP";
  email: string;
  role?: string;
  otp?: string;
  link?: string;
}

/**
 * DEV/UAT ONLY: Logs OTP codes and invite links to terminal console and .planning/dev-auth-logs.txt
 * to enable fast, zero-email-setup manual testing across multiple user roles.
 *
 * NOTE: Gated by (process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_AUTH_LOGS === "true").
 * Tracked in Phase 6 Launch Readiness for removal before production release.
 */
export function logDevAuthEvent(event: DevAuthEvent): void {
  const isProd = process.env.NODE_ENV === "production";
  const explicitEnable = process.env.ENABLE_DEV_AUTH_LOGS === "true";

  if (isProd && !explicitEnable) {
    return;
  }

  const timestamp = new Date().toISOString();
  const bannerBorder = "════════════════════════════════════════════════════════════════════";
  const lines = [
    `\n${bannerBorder}`,
    `[CLINICOS DEV/UAT AUTH] ${event.type} — ${timestamp}`,
    `Email:    ${event.email}`,
    event.role ? `Role:     ${event.role}` : null,
    event.otp ? `🔑 OTP:   ${event.otp}` : null,
    event.link ? `🔗 Link:  ${event.link}` : null,
    `${bannerBorder}\n`,
  ]
    .filter(Boolean)
    .join("\n");

  // 1. Output to server console for instant visibility in terminal
  console.log(lines);

  // 2. Append to persistent file .planning/dev-auth-logs.txt
  try {
    const logFilePath = path.join(process.cwd(), ".planning", "dev-auth-logs.txt");
    fs.appendFileSync(logFilePath, lines + "\n", "utf8");
  } catch (err) {
    console.warn("[lib/auth/dev-logger] Failed to write to dev-auth-logs.txt:", err);
  }
}
