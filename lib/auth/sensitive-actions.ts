/**
 * V2-09d 09D-01a, ruling R-S (AUTH_REDESIGN §3.5 step 3): the closed list of sensitive actions. This file is the one place
 * the list lives; `tests/auth/sensitive-actions-db.spec.ts` fails when an entry point below skips the check, and when an
 * entry point the list names no longer exists.
 *
 * Every action on the list gets three checks on every call, never from the session-context cookie:
 *   1. `session_is_live()` (migration 000087): the JWT's `session_id` still has a row in `auth.sessions` (refused after
 *      sign-out everywhere, a password change or reset, or a staff removal elsewhere, while the access token is unexpired);
 *   2. a fresh membership and role read from the database (`memberships`; the per-request memo holds only database answers);
 *   3. the access level from the database (`my_tenant_access`).
 * Membership actions get them through the guards' `{ sensitive }` option (`requireServiceContext` / `resolveServiceContext`
 * / `requirePermission`); the two account actions (password change, reset completion) act on the caller's own Auth
 * account with or without a clinic, so they get check 1 only (`lib/auth/session-live.ts`), after their own session read.
 *
 * Everything else keeps the fast path (claims + cookie); RLS and the definer commands re-check membership, role and
 * access in the database on every read and write. Out of scope here (not a session): the `/api/v1` API-key routes,
 * including the DPDP export and erasure there (`DELETE /api/v1/patients/[id]` is the only erasure entry point), whose
 * control is the key itself. The database-side liveness check inside the RPCs and insert rules is V2-14 backlog.
 *
 * Values: the entry points (`<file>#<export>` for a Server Action, `<file>#<METHOD>` for a route handler), as the
 * server-action inventory names them (`scripts/inventory-server-actions.ts`).
 */
export const SENSITIVE_ACTIONS = {
  // Staff management: invite, remove, role or permission edit.
  "staff.invite": ["features/staff/actions.ts#inviteStaff"],
  "staff.invite.resend": ["features/staff/actions.ts#resendInvite"],
  "staff.invite.revoke": ["features/staff/actions.ts#revokeInvite"],
  "staff.remove": ["features/staff/actions.ts#removeStaff"],
  "staff.role_edit": ["features/settings/actions.ts#updateStaffMember"],
  // API keys and webhook subscriptions: create, rotate (none exists today), delete.
  "api_keys.create": ["features/api-keys/actions.ts#createApiKey"],
  "api_keys.revoke": ["features/api-keys/actions.ts#revokeApiKey"],
  "webhooks.create": ["features/webhooks/actions.ts#createWebhookSubscription"],
  "webhooks.delete": ["features/webhooks/actions.ts#deleteWebhookSubscription"],
  // The DPDP export (the in-app, session route; erasure has no session entry point).
  "dpdp.export": ["app/api/patients/[id]/export/route.ts#GET"],
  // Clinic settings writes.
  "clinic_settings.update": ["features/settings/actions.ts#updateClinicSettings"],
  "clinic_settings.statutory": ["features/settings/actions.ts#updateStatutorySettings"],
  "clinic_settings.rx_print": ["features/settings/actions.ts#updateRxPrintSettings"],
  "clinic_settings.profile": [
    "features/clinics/profile.ts#updateClinicProfile",
    "app/(dashboard)/settings/clinic/actions.ts#updateClinicProfileAction",
  ],
  // Billing and subscription writes (no in-app subscription write exists today; a new one joins this list).
  "billing.invoice.create": ["features/billing/actions.ts#createInvoice"],
  "billing.invoice_item.add": ["features/billing/actions.ts#addInvoiceItem"],
  "billing.invoice_item.delete": ["features/billing/actions.ts#deleteInvoiceItem"],
  "billing.payment.record": ["features/billing/actions.ts#recordPayment"],
  "billing.payment.collect": ["features/billing/actions.ts#collectPayment"],
  "billing.complete_and_bill": ["features/billing/actions.ts#completeAndBillConsultation"],
  // Password and account security.
  "account.password.change": ["features/auth/actions.ts#changePasswordAction"],
  "account.password.reset": ["features/auth/actions.ts#setNewPasswordAction"],
  // Any call to an external AI provider (every AI gateway entry point).
  "ai.soap.generate": ["features/ai/actions.ts#generateSoapAction"],
} as const satisfies Record<string, readonly string[]>;

export type SensitiveAction = keyof typeof SENSITIVE_ACTIONS;

/** The account actions: liveness only (no clinic membership is involved). */
export const ACCOUNT_SENSITIVE_ACTIONS = ["account.password.change", "account.password.reset"] as const satisfies readonly SensitiveAction[];

/** Every entry point on the list, with its action. */
export function sensitiveEntryPoints(): Array<{ action: SensitiveAction; entry: string }> {
  return (Object.entries(SENSITIVE_ACTIONS) as Array<[SensitiveAction, readonly string[]]>).flatMap(([action, entries]) =>
    entries.map((entry) => ({ action, entry })),
  );
}

/** Options of the context guards: name the sensitive action to get the three checks above. */
export interface GuardOptions {
  sensitive?: SensitiveAction;
}
