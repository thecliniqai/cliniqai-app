"use server";

import type { SetPasswordResult } from "./password-flows";
import { changePassword, setNewPassword } from "./service";
import { acceptInviteWithPassword, type AcceptInviteWithPasswordResult } from "./invite-flows";

/**
 * Password server actions (V2-03 03-12a: AUTH-04b, FT-05, A00-5). Guard kind `self` (tests/security/guard-manifest.ts):
 * each acts only on the session user's own account, authenticated from the request's cookie session; the input
 * carries passwords only (no user id, no `*Override`). See features/auth/service.ts for the order of checks.
 */

/** `/profile` change password: current + new password; other sessions are signed out on success. */
export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<SetPasswordResult> {
  return changePassword(input);
}

/** Forgot-password final step, on the recovery session the browser just established with the emailed code (R-5). */
export async function setNewPasswordAction(input: { newPassword: string }): Promise<SetPasswordResult> {
  return setNewPassword(input);
}

/**
 * AUTH-06 (V2-05 05-07b): an invitee without an account sets a password from the `/join` link. Public by design (the
 * invitee has no session): the invitation token is the authorisation, checked after the server-side Turnstile check,
 * the password policy and FT-05 (features/auth/invite-flows.ts; guard kind `public-token` in the manifest). The account
 * is created only for the address the invitation names; nothing of the account or the clinic is returned.
 */
export async function acceptInviteWithPasswordAction(input: {
  token: string;
  password: string;
  turnstileToken: string;
}): Promise<AcceptInviteWithPasswordResult> {
  return acceptInviteWithPassword(input);
}
