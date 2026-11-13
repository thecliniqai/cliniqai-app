"use server";

import type { SetPasswordResult } from "./password-flows";
import { changePassword, setNewPassword } from "./service";

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
