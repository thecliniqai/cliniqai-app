# 0005: Confine the service-role client; no overrides in server actions

- **Status:** Proposed — to be ratified at gate G0 (end of V2-00) after an isolated Claude review and PO
  sign-off. Source: `docs/v2/ARCHITECTURE_DECISIONS.md` ADR-005; finding SEC-01/SEC-02, ARC-01.
- **Context:** Exported `"use server"` functions accept `sessionOverride`/`clientOverride`. With
  `sessionOverride` they skip `requirePermission()` and switch to the service-role client, e.g.
  `features/patients/actions.ts:249-256` (`searchPatients`). Server actions are callable from the browser
  with caller-chosen arguments, so anyone who knows a clinic UUID can read or change that clinic's data.
  Other sites with the same pattern: `features/patients/actions.ts:174,255,278`,
  `features/patients/consent.ts:163`, `features/settings/actions.ts:48,179`. There are five separate
  service-role client factories: `lib/supabase/admin.ts`, `features/appointments/actions.ts`,
  `features/auth/dev-actions.ts`, `lib/messaging/dispatcher.ts` and `lib/storage/supabase-provider.ts`
  (ARCHITECTURE_DECISIONS ADR-005, erratum C3).
- **Decision:**
  1. Remove every `sessionOverride`/`clientOverride` parameter from exported server actions (phase V2-01).
     Tests call domain services with an explicit context instead.
  2. One `getSystemDb(reason)` factory, importable only from `lib/jobs/**`, `features/*/system.ts` and
     `app/api/{jobs,webhooks}/**` (enforced by a lint rule); every use is logged.
  3. Public-link flows use SECURITY DEFINER RPCs scoped to the token, not broad service-role queries.
- **Alternatives considered:** keep overrides behind `NODE_ENV === 'test'` — rejected: brittle, and the
  attack surface stays in production builds.
- **Consequences:** (+) closes the unauthenticated cross-tenant hole; (−) the DB-backed tests that rely on
  overrides must be restructured — done on the local harness (V2-01a) before the removal (V2-01).
- **Verification:** a test that calls each formerly-overridable action with a forged override and gets
  an authentication error; lint rule fails CI on any service-role import outside the allowed paths;
  grep in CI for `sessionOverride|clientOverride` in `"use server"` files returns nothing.
