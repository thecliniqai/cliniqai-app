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
      // 03-13a (M-EMAILCAP): GoTrue refused to send (per-address interval or the project-wide email cap).
      reset_send_limited: "We can't send a code right now. Try again later.",
      // 03-13a (ruling R-35): a reset ends signed out.
      reset_done: "Your password was changed. Sign in with your new password.",
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
    // V2-05 05-07b (AUTH-06): the /join page and invite acceptance. Fixed texts only; never database or provider text.
    invite: {
      title: "Join your clinic",
      intro: "Accept your invitation to the clinic team on ClinicOS.",
      incomplete: "This invitation link is incomplete. Ask your clinic to send it again.",
      not_found: "This invitation link is not valid. Ask your clinic to send a new one.",
      expired: "This invitation has expired. Ask your clinic to send a new one.",
      revoked: "This invitation has been withdrawn. Ask your clinic for a new invite.",
      used: "This invitation has already been used. Sign in to continue.",
      sign_in_to_accept: "Already have a ClinicOS account? Sign in, then open this link again to accept.",
      set_password_intro: "New to ClinicOS? Choose a password to create your account and join the clinic.",
      account_exists: "An account already exists for this address. Sign in, then open this link again to accept.",
      email_mismatch: "This invitation was sent to a different email address. Sign in with that address to accept it.",
      already_member: "You are already a member of this clinic.",
      captcha_unconfigured: "Invitation sign-up is not available right now. Ask your clinic to contact support.",
      accepted: "Your account is ready. Sign in with your new password.",
      accept_failed: "We couldn't accept this invitation. Try again.",
    },
  },
  // V2-05 05-10b (SUB-02, SUB §7.2 item 3): the functional locked and onboarding pages (styled in V2-13b, SUB-08).
  // Fixed texts only. Times are shown in IST (SUB §10.3).
  subscription: {
    status: {
      incomplete: "Setup incomplete",
      trialing: "Free trial",
      active: "Active",
      past_due: "Payment due",
      expired: "Expired",
      archived: "Archived",
      purged: "Closed",
    },
    locked: {
      title: "Your clinic's access is paused",
      intro: "The subscription for this clinic is not active, so the clinic's records can't be opened right now.",
      clinic: "Clinic",
      status: "Subscription status",
      access_ended: "Access ended",
      unknown: "Not available",
      data_safe: "Your clinic's data is safe. Nothing has been deleted.",
      renewal: "Renewal and export open with billing (V2-13b/V2-13c).",
    },
    locked_staff: {
      title: "Your clinic's subscription is inactive",
      body: "Your clinic's subscription is inactive; contact the owner.",
      clinic: "Clinic",
    },
    onboarding: {
      title: "Finish setting up your clinic",
      clinic: "Clinic",
      owner_body: "Your clinic has been created. Billing setup opens with AUTH-07/SUB-03 in V2-13b; your clinic's pages open once it is done.",
      staff_body: "Your clinic is still being set up. Contact the owner.",
    },
    sign_out: "Sign out",
  },
} as const;
