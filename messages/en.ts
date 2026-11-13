/**
 * English UI copy (V2-03 03-12a). Plain data, client-safe. The auth error catalogue (`features/auth/errors.ts`,
 * AUTH_REDESIGN §4.2) reads its fixed messages from here; no Supabase `error.message` is ever shown (AD-7).
 */
export const en = {
  auth: {
    errors: {
      // Sign-in: one message for a wrong password, an unknown email and an unconfirmed email (no account enumeration).
      invalid_credentials: "Email or password is incorrect",
      email_not_confirmed: "Email or password is incorrect",
      // A00-4: both GoTrue rate-limit codes (HTTP 429) get the same "wait a minute" message.
      over_request_rate_limit: "Too many attempts, please wait a minute",
      over_email_send_rate_limit: "Too many attempts, please wait a minute",
      otp_expired: "Code is wrong or expired",
      weak_password: "Choose a stronger password of at least 10 characters",
      same_password: "Choose a different password",
      captcha_failed: "We couldn't verify this request. Try again.",
      current_password_required: "Enter your current password",
      current_password_invalid: "Your current password is incorrect",
      user_already_exists: "We couldn't complete this request. Try signing in instead.",
      otp_disabled: "Sign-in with a code is not available. Use your password.",
      signup_disabled: "New accounts can't be created here. Ask your clinic for an invitation.",
      session_not_found: "Your session has ended. Please sign in again.",
      // App codes.
      pwned_password: "This password has appeared in a data breach. Choose a different one.",
      reauth_required: "For your security, please sign in again before changing your password.",
      generic: "Something went wrong, please try again",
    },
    flows: {
      sign_in_failed: "Sign-in failed, try again",
      reset_request_failed: "We couldn't send the code, try again",
      reset_failed: "We couldn't reset your password, try again",
      change_failed: "We couldn't change your password, try again",
      reset_session_stale: "This reset has expired. Request a new code and try again.",
    },
    // 03-12c (C43): the Cloudflare Turnstile check on sign-in and the reset request.
    captcha: {
      label: "Security check",
      loading: "Loading the security check…",
      required: "Complete the security check, then try again.",
      failed: "The security check failed. Reload the page and try again.",
      expired: "The security check expired and is refreshing. Try again in a moment.",
      unavailable: "The security check could not load. Check your connection and reload the page.",
    },
    changePassword: {
      success: "Password changed. Other devices were signed out.",
      successOthersRemain: "Password changed, but we could not sign out your other devices.",
    },
  },
} as const;
