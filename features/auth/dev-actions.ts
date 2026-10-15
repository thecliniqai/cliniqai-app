"use server";

import { logDevAuthEvent } from "@/lib/auth/dev-logger";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface RequestOtpResult {
  success: boolean;
  error?: string;
  devOtp?: string | null;
  magicLink?: string | null;
}

/**
 * DEV/UAT ONLY: Generates a valid Supabase email OTP code without requiring
 * external SMTP / real email inbox delivery, and logs it prominently to terminal
 * and .planning/dev-auth-logs.txt for manual testing.
 */
export async function requestOtpAction(
  email: string,
  context: "login" | "join" = "login"
): Promise<RequestOtpResult> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    return { success: false, error: "Please enter a valid email address." };
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const isDevOrTest =
      process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_AUTH_LOGS === "true";

    let devOtp: string | null = null;
    let magicLink: string | null = null;

    if (serviceKey && isDevOrTest) {
      // 1. Generate OTP directly in Supabase Auth via Admin API
      const admin = createAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: cleanEmail,
      });

      if (!error && data?.properties) {
        devOtp = data.properties.email_otp || null;
        magicLink = data.properties.action_link || null;
      } else if (error) {
        console.warn("[features/auth/dev-actions] generateLink warning:", error.message);
      }
    }

    // 2. Fallback to standard Supabase signInWithOtp if admin generation was unavailable
    if (!devOtp) {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: true },
      });

      if (error) {
        return { success: false, error: error.message };
      }
    }

    // 3. Log to terminal console & .planning/dev-auth-logs.txt
    if (devOtp || magicLink) {
      logDevAuthEvent({
        type: context === "login" ? "LOGIN_OTP" : "JOIN_OTP",
        email: cleanEmail,
        otp: devOtp || undefined,
        link: magicLink || undefined,
      });
    }

    return {
      success: true,
      devOtp: isDevOrTest ? devOtp : null,
      magicLink: isDevOrTest ? magicLink : null,
    };
  } catch (err: unknown) {
    console.error("[features/auth/dev-actions] Error generating OTP:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate verification code.",
    };
  }
}
