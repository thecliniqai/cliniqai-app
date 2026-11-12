# Independent review: V2-01 security containment, `b9d2ad5..1e42ac9`

Reviewer: isolated Claude reviewer (fresh context). Scope: 17 commits, 232 files (01-07, 01-03, 01-06, 01-01a..d, 01-02, 01-04).
The tree was read at `1e42ac9` (a `git archive` snapshot, so uncommitted 01-05 work was left out).

Tools run on the snapshot: `tsc --noEmit` exited 0, and `npx eslint . --quiet` exited 0. Tests were not run, as the brief asked.

## Verdict: **approve-with-fixes**

No Critical or High findings. The override removal, the membership guard, the webhook lockdown, the token-scoped
share RPCs and the password login hold up when checked against the code. The refactor is mechanical and faithful:
- Every domain's permission strings appear in both the action and the service, with no check dropped.
- Every revalidated path is preserved.
- `completeAndSignConsultation` and other functions I sampled differ from v1 only by the `ctx` substitution.

The gate is not complete yet. Some acceptance items belong to the unfinished plan 01-05, and the "suites pass before
and after" item has no tool-produced evidence in the repo.

Counts: Critical 0 · High 0 · Medium 2 · Low 5

---

## Findings

### M1. "Existing suites pass on the local stack before and after" has no evidence in the repo
- **Where:** `.planning/phases/01-security-containment/evidence/` (untracked) holds only `server-action-inventory.json`.
  No before/after runner logs are committed, and none are referenced by commit SHA.
- **Scenario:** at the gate, the PO cannot check the roadmap acceptance item or CLAUDE.md DoD #5 ("evidence produced
  by the tools"). The plan text (line 15) and the commit messages are hand-typed claims.
- **Fix:**
  - Commit the local-lane runner output, a JUnit or JSON reporter file, for both `1491899` (baseline) and the final SHA.
  - Include the per-file pass, fail and skip counts.
  - List the deleted retired specs, as the plan's "Retired specs" paragraph requires.

### M2. `create_share_token` checks membership only, so the app's per-resource permission checks can be bypassed
- **Where:** `supabase/migrations/000020_share_token_binding.sql:150-194`. EXECUTE is granted to `authenticated`, and
  the only check is "a member of the resource's tenant".
- **What the app requires** before it mints a token:
  - `features/prescriptions/service.ts` (`sharePrescriptionViaWhatsApp`): `consultations:view`.
  - `features/billing/service.ts` (`shareReceiptViaWhatsApp`): `billing:view`.
  - The labs and referrals share functions: `patients:view`.
- **Scenario:**
  1. A receptionist has no `consultations:view`; F9 deliberately removed their Rx PDF link.
  2. They call `POST /rest/v1/rpc/create_share_token {p_resource_type:'prescription', p_resource_id:<rx id>}` with
     their own JWT.
  3. `GET /api/r/<token>?download=true` then returns a signed URL to the Rx PDF.
  4. That link works for anyone for 7 days.
- **Mitigating:** this is not a regression. The v1 policy `doc_tokens_staff_manage` let any member insert. The
  `prescriptions` storage SELECT policy (`000008:37-42`) also lets any member read the object directly.
- **Why it still matters:** the RPC is the point P0-04 introduced to enforce ownership. As written, it turns any
  member's read into an **anonymous, shareable 7-day link**, while the action layer pretends otherwise. F17 defers
  token hashing, but nothing records this gap.
- **Fix:**
  - Inside the RPC, map `resource_type` to the allowed roles (prescription: owner/doctor/nurse; invoice:
    owner/admin/receptionist; …) until `has_permission` lands in V2-05.
  - Or record this explicitly as an accepted follow-up owned by V2-05 P1-01, next to F17.

### L1. `resolveServiceContext` sends the database error text to the browser despite its "safe to show" contract
- **Where:**
  - `lib/auth/context.ts:55-70`: the `no_membership` branch returns `err.message`.
  - `lib/auth/tenant.ts:48` throws `` `Failed to resolve clinic membership: ${memError.message}` ``.
- **Effect:** every server action returns `{ success:false, error: resolved.error }`. The PDF routes return it as
  the HTTP 500 body (`app/api/invoices/[id]/receipt-pdf/route.ts:24`, and the same in the prescription-pdf route).
  A PostgREST or Postgres error message therefore reaches the client.
- **Not a regression:** v1 behaved the same way. But this helper is new, and its comment says "The message is safe to
  show to the caller".
- **Fix:** return a fixed string for `no_membership` and log only `error.code` on the server.

### L2. Moved code still returns Supabase `error.message` or `err.message` to the client
- **Where:** all pre-existing, copied verbatim into the new services:
  - `features/notifications/service.ts:69,116,153,209`
  - `features/referrals/service.ts:274,310,392,535`
  - `features/settings/service.ts:157,221,302,401,482,554`
  - `features/staff/actions.ts:86`
  - `app/api/invoices/[id]/receipt-pdf/route.ts:187`
- **Effect:** none of these is a regression. They contradict AD-7, which the new auth code follows.
- **Fix:** either fix them in V2-03 P1-25 (error mapping) or list them as a follow-up so they are not lost.

### L3. `updateStaffMember` can change the role and still report failure
- **Where:** `features/settings/service.ts:341-384`. `change_member_role` commits in its own transaction, and then
  the profile UPDATE runs.
- **Scenario:**
  1. An owner changes a doctor to receptionist and edits the phone number at the same time.
  2. The profile UPDATE fails, for example on the phone normalisation constraint or an RLS miss.
  3. The role change is already committed and audited.
  4. The action returns `success:false, "Failed to update staff member in database."` and does not revalidate.
  5. The UI shows an error and the old role, so the owner may retry and get confused.
- **Fix:** run the profile update first and the role RPC second (the profile update is reversible and lower risk). Or
  report a partial success that says the role was changed.

### L4. `search_medicines` assumes `pg_trgm` is installed in `public`
- **Where:** `000019_membership_guard.sql:333-334` calls `public.similarity(...)` under `SET search_path = ''`.
- **Scenario:** on a project where `pg_trgm` was enabled into `extensions` (the Supabase dashboard default), the
  function fails on every call. Every drug search then shows "Failed to search medicines." A fresh database built from
  `000007` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`, no schema) gets `public`, so local and a new prod are fine. The
  risk is staging, or any project where the extension was enabled first.
- **Fix:** pin the schema in a migration (`CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public` is a no-op if it
  already exists, so verify it), or resolve the function through `SET search_path = pg_catalog, public, extensions`.

### L5. Inbound webhook trusts any `from` once a `replyMsgId` correlates
- **Where:** `app/api/webhooks/messaging/[provider]/route.ts:192-222` and `224+`. The visit comes only from the queue
  row (correct, per P0-03). `from` is never compared with `queueItem.recipient_phone`.
- **Scenario:** with the shared header secret, any caller who knows or guesses an `external_message_id` can confirm
  or cancel that patient's appointment. Acks would then go to an arbitrary `from` number. Messages are sent to `from`,
  not to the patient's stored phone.
- **Fix (defence in depth):** require that the normalised `from` equals the queue row's `recipient_phone`, and treat a
  mismatch as unmatched.

(Not reported as findings: `consume_reschedule_token` accepts any future time without an availability or conflict
check, and `/r` shows "Link Expired" for unknown tokens. Both are unchanged from v1. The slot rules sit with F16 and
V2-08.)

---

## Checks that passed (verified, not assumed)

**Migrations**
- 000019 and 000020 are re-runnable: `CREATE OR REPLACE`, `DROP … IF EXISTS`, and an inline CHECK whose auto-name
  `document_share_tokens_resource_type_check` matches the `000014` column definition.
- Every new SECURITY DEFINER function sets `search_path = ''` and schema-qualifies its references.
- EXECUTE is revoked from `PUBLIC` and also from `anon`/`authenticated`, which Supabase's default privileges grant
  explicitly.
- Internal helpers (`share_resource_tenant`, `share_token_resource`) have no API-role EXECUTE.
- Service-only RPCs (`create_reschedule_token`, `share_token_object`, `reschedule_token_visit`) are granted to
  `service_role` only.

**Membership guard**
- A table-level REVOKE comes first, then the column grant, so the column REVOKE takes effect.
- Every app write to `memberships` touches only granted columns: `settings/service.ts` lines 109, 264, 374, 453, 532.
- No app path updates `invitations` or `document_share_tokens` directly.

**Share links**
- Kind and tenant binding is checked before revoked/expired, so no oracle exists across types.
- The storage path prefix is re-checked in `features/sharing/system.ts:52-59`.
- Buckets and paths match what the generators write: Rx `<tenant>/<visit>/rx_vN.pdf`, receipts
  `<tenant>/receipts/…`, referrals and labs `tenants/<tenant>/…`.
- Reschedule consume locks the token row and revokes it in the same transaction as the visit update (single use).
- The reschedule page no longer reads the removed `id` and `patient_name` fields.

**Webhook**
- Only `msg91` is accepted. Every other provider and every non-POST method returns 404.
- The secret is read from the header only, compared over SHA-256 digests with `timingSafeEqual`, and fails closed when
  unset. A bad secret returns 401 before any database access.
- Lookups use `.eq` only, and the phone fallback is gone. Responses are `{ok:true|false}` only.

**Auth**
- The only `verifyOtp` call is pinned to `type:'recovery'`.
- The new password is validated before the code is consumed. There is a retry path when the update fails after
  verify, and `signOut({scope:'others'})` runs after the update.
- Auth errors are mapped from `error.code` only. `enable_signup=false`, and the recovery template is code-only.

**Revalidation and context**
- Revalidation parity: a per-export comparison of `revalidatePath` arguments between v1 actions and the new actions
  found no dropped path (the differences are only variable renames).
- RSC pages switched to `requireServiceContext()` and services. The redirect-on-throw behaviour is unchanged.

**Tests**
- The new security specs assert database state and HTTP outcomes, not rendering. Examples:
  - `share-tokens.spec.ts`: a cross-tenant token gives a 404 identical to a missing token; concurrent reschedule
    gives exactly one 200 and one 410.
  - `membership-guard.spec.ts`: the last-owner guard.
  - `p0-01-forged-overrides.spec.ts`: tenant-B rows are untouched.
  - `password-auth.spec.ts`: Mailpit email counts.

---

## V2-01 acceptance checklist (roadmap §12.2, verbatim items)

| # | Acceptance item | Status | Evidence |
|---|---|---|---|
| 1 | grep/AST rule finds 0 override params | **Met** | `eslint.config.mjs` rules + `lint-fixtures/p0-01/*` + `tests/security/override-lint-gates.spec.ts`. `eslint . --quiet` exits 0 on the snapshot. `grep -rl Override app features lib` returns nothing. Type-aware inventory exists (`scripts/inventory-server-actions.ts`); its CI wiring is F14 → V2-02. |
| 2 | Forged-override calls are rejected | **Met** (code + tests; run not evidenced) | All actions use `resolveServiceContext(perm)` with no extra parameters. `tests/security/p0-01-forged-overrides.spec.ts` and `p0-01-action-sweep.spec.ts` assert unauthenticated and receptionist outcomes and that tenant B is untouched. |
| 3 | A receptionist PATCH of `role` is denied | **Met** | `000019:17-27` (REVOKE + column grant excluding `role`); `change_member_role` checks the caller's role; `tests/security/membership-guard.spec.ts` (TC-RLS-MEM-02/03). |
| 4 | `/api/webhooks/messaging/dev` returns 404 or 401 | **Met** | `route.ts:407-423` (provider ≠ msg91 → 404, all methods); `tests/security/webhook-lockdown.spec.ts`. |
| 5 | A cross-tenant token returns 404 | **Met** | `share_token_resource` filters on `id AND tenant_id = token.tenant`; `share-tokens.spec.ts:260-330`. See M2 for the remaining creation-side permission gap. |
| 6 | A PATCH of a completed visit through `/api/v1` is rejected | **Not met at `1e42ac9`** | `app/api/v1/visits/[id]/route.ts` at `1e42ac9` has no lock check in the PATCH or the UPDATE filter. Assigned to 01-05 (in progress). |
| 7 | Seeded users sign in by password; a normal login sends 0 emails (Mailpit) | **Met** (code + test; run not evidenced) | `features/auth/password-flows.ts` `signIn` (`/token` grant only); `tests/integration/auth/password-auth.spec.ts:160` asserts a Mailpit count of 0. |
| 8 | grep finds 0 `shouldCreateUser`/`devOtp` | **Met** | Matches appear only in `eslint.config.mjs` selectors and `lint-fixtures/auth-01/*`, which are the intentional negative fixtures. `features/auth/dev-actions.ts`, `lib/auth/dev-logger.ts`, `/verify` and `/auth/callback` are deleted. |
| 9 | No `/api/ai/*` copilot route is reachable | **Met** | `app/api/ai/` no longer exists; `tests/security/ai-containment.spec.ts`. |
| 10 | Existing suites pass on the local stack before and after | **Not evidenced** | See M1. No runner output is committed. |
| — | Scope items outside the acceptance list | **Partly** | P0-05 (lab-orders prefix + zod), P0-06 (Next 15.5.x), P1-23, the `API_V1_ENABLED` switch and the API PATCH guard are all 01-05 and absent at `1e42ac9`. AI-01, AUTH-01, AUTH-04a, P0-01, P0-02, P0-03 and P0-04 are implemented. |

**Gate recommendation:**
- Fix or explicitly accept M2.
- Attach before/after run evidence (M1).
- Land 01-05.
- Then re-review the 01-05 diff, which touches the `/api/v1` PATCH guard and the lab-orders storage path, both
  security-sensitive.
