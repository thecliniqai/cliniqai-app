# Secret rotation record

Backlog P0-07 (deferred from V2-00 to V2-15 by PO ruling C49). Record **names and dates only — never values.** The PO rotates each secret in the
provider dashboard, updates the local `.env` (agents are denied from reading it), then fills the table.

**Why rotate (before go-live):** `.env` held the Supabase service-role key and an account-wide `SUPABASE_ACCESS_TOKEN`,
and several agent runtimes (Antigravity, OpenCode with a free third-party reviewer model) worked in this
repo with no `.env` deny rules (VERIFICATION_LOG W-02, G-2). Exposure cannot be ruled out. The current
Supabase project is a test database with no real patient data (PO-1), so this is hygiene, not an incident.

> **PO ruling (G0, 2026-11-10, C49): no rotation in V2-00.** The hosted Supabase project is a test project
> that is discarded when v2 goes live; production is a new project with new keys. **Rotation is mandatory
> before go-live in V2-15** (roadmap §17.1) for every secret not scoped to the test project:
> `SUPABASE_ACCESS_TOKEN` (account-wide: revoke), `MSG91_AUTH_KEY`, `MSG91_WEBHOOK_SECRET`, `AI_API_KEY`,
> and every other non-test-project secret found in `.env.example` or the code (`R2_*`, `CRON_SECRET`,
> `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GUPSHUP_API_KEY`, `TWILIO_AUTH_TOKEN`) if set. The
> test project's own keys (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) are N/A: the
> project is discarded, and production gets new keys. Until then the PO accepts the residual risk that these were seen by
> earlier agent runtimes (W-02, G-2). The table below is filled in V2-15.

| Secret (env name) | Provider / where to rotate | Rotated on | By | Old value rejected (smoke check) |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → JWT keys / API keys (rotate secret key; legacy JWT secret rotation invalidates anon too) | | PO | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same place (publishable key) — rotates with the JWT secret if using legacy keys | | PO | |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens: **revoke**; do not keep a personal access token in the app `.env` (only CLI use, in your shell) | | PO | |
| `MSG91_AUTH_KEY` | MSG91 → Authkey → regenerate | | PO | |
| `MSG91_WEBHOOK_SECRET` | Generate a new random value; update MSG91 webhook config | | PO | |
| `AI_API_KEY` (Gemini AI Studio) | Google AI Studio → API keys → delete and recreate. In v2 the AI provider becomes Vertex AI in `asia-south1` (AI_STRATEGY) | | PO | |
| `CRON_SECRET` (if set) | Generate a new random value. Since V2-04 it is only the bearer of `/api/diag/error` (and of `/api/cron/*` until 04-03a/b delete them); never the job runner's (R-27) | | PO | |
| `JOBS_RUNNER_SECRET` + Vault `jobs_runner_secret` (V2-04 04-02) | `openssl rand -hex 32`; the same value in Vercel and in Supabase Vault (SQL editor). Rotate through `JOBS_RUNNER_SECRET_NEXT` with no missed kick: docs/runbooks/jobs.md §3 | | PO | `POST /api/jobs/run` with a token minted from the old secret (runbook §5) → 401 |

Not secrets (no rotation): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`, `MSG91_INTEGRATED_NUMBER`,
`MSG91_SENDER_ID`, `MESSAGING_PROVIDER`, `AI_PROVIDER`, `AI_MODEL_NAME`, `AI_BASE_URL`.
Referenced in code but not in `.env.example` (check they are unset or rotate): `GEMINI_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `GUPSHUP_API_KEY`, `TWILIO_AUTH_TOKEN`, `CRON_SECRET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` (read in `lib/storage`; R2 is removed in v2, C23, so revoke the token if one exists).

**Smoke check after rotation (V2-15):** for each rotated secret, one call with the old value is rejected by its
provider (e.g. the revoked `SUPABASE_ACCESS_TOKEN` gets 401 from the Management API) and the app works with the
new value. Record "yes" in the last column; the two test-project rows are "N/A (C49)".

## P0-16a — backup check for the hosted test project

Recorded 2026-11-10: **not required.** PO-1 confirmed the hosted project is a test database with no
real data; leftover test clinics and `@example.com` users were deleted on PO instruction (PO-14; the
deletion was not re-verified, see VERIFICATION_LOG PO-14 row). Production will be a new project that starts empty with the FT-02 encrypted
backup job live from day one (roadmap §9.1). No migration will be run against the test project; it is
paused or deleted before staging is created (V2-03).

## Production rotation checklist (V2-15, CTO-2)

Claude never sees values and cannot read `.env*`, so it cannot know which optional secrets exist. The PO runs, on their
own machine, the names-only inventory and works through its output:

```
# names from the stores via their CLIs (values are never read or printed)
node scripts/prod/secret-inventory.mjs --vercel --github-secrets --supabase-ref <production project ref>
# names from a local env file: make a names-only file first, then pass it (the script refuses dotenv-style file names
# and any line containing "=")
grep -o '^[A-Za-z_][A-Za-z0-9_]*=' <your local env file> | tr -d '=' > /tmp/names.txt
node scripts/prod/secret-inventory.mjs --names-file /tmp/names.txt && rm /tmp/names.txt
```

The output is a checklist with an action per name (revoke, rotate, review). It also lists known names that were **not**
found, so you can confirm they are unset in every store. Pre-filled from `.env.example`, the env schema and the code:

| Name | Action before UAT start | Production rule |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | revoke (account-wide) | never in the app environment; CLI use only, in your shell |
| `SUPABASE_SERVICE_ROLE_KEY`, publishable key | new production values only | the test project's keys are discarded (C49) |
| `MSG91_AUTH_KEY`, `MSG91_WEBHOOK_SECRET` | rotate | webhook secret sent as a header |
| `AI_API_KEY` and `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | rotate or delete | no AI is sold at UAT start |
| `GUPSHUP_API_KEY`, `TWILIO_AUTH_TOKEN` (and their SIDs, numbers) | revoke if present | unused in v2 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | revoke the Cloudflare token | R2 removed from the app (C23) |
| `CRON_SECRET`, `JOBS_RUNNER_SECRET` + Vault `jobs_runner_secret` | new random values | production values differ from each other and from staging |
| `RESEND_API_KEY` | new production key | sending access, domain-restricted |
| Razorpay live key secret and webhook secret | live values only | never `rzp_test_` in production |
| Backup: age identity, S3 role, IAM | per `docs/ops/backup-restore.md` | primary in the password manager, break-glass sealed offline |

After each row: one call with the **old** value is refused by the provider (e.g. Management API 401 for the revoked
token) and the app works with the new value. Record the date and "yes" in the table above (names and dates only). Rows
for the test project's own keys stay "N/A (C49)".
