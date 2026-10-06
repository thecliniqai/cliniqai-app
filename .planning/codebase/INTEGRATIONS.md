# External Integrations

**Analysis Date:** 2026-10-06

> **Current state: zero integrations implemented.** No SDK imports, clients, webhooks, database connections, auth wiring, or service credentials exist in application code — there is no application code at all (see `STACK.md`). No `.env*` files are present. Everything under each section is marked as either *(none on disk)* or **documented intent** (specification from `docs/clinic-management-prd.md`, `AGENTS.md` — not yet built).

## APIs & External Services

**Messaging — SMS *(documented intent, not implemented)*:**
- SMS gateway for appointment reminders, prescription/lab delivery notices, follow-up/vaccination/refill reminders - `docs/clinic-management-prd.md` §4.8, §6
  - Candidate vendors: MSG91 or Twilio - `docs/clinic-management-prd.md` §6
  - SDK/Client: none installed
  - Auth: not configured (no env files exist)
  - Required pattern: pluggable provider adapter, never hard-coded to one vendor - `docs/clinic-management-prd.md` §6; `AGENTS.md` §41 ("Wrap external vendors behind interfaces/adapters")
  - Reliability requirement: if the provider is down, in-app clinical workflows must keep working - `docs/clinic-management-prd.md` §5.5

**Messaging — WhatsApp *(documented intent, not implemented)*:**
- WhatsApp Business API for reminders, PDF delivery (prescriptions/receipts), patient self-booking links, two-way confirm/cancel/reschedule replies - `docs/clinic-management-prd.md` §4.2, §4.5, §4.8, §4.10
  - Delivered via a BSP/partner — e.g. Gupshup, Twilio — selected early because Meta approval/onboarding takes 1–2 weeks - `docs/clinic-management-prd.md` §6, §9.4
  - SDK/Client: none installed
  - All patient communication must be logged against the patient record (audit/consent) - `docs/clinic-management-prd.md` §4.8

**AI / LLM *(documented intent, not implemented)*:**
- LLM API (e.g. Claude API) for visit summarization, structured note drafting, patient history catch-up summaries, assistive prescription suggestions - `docs/clinic-management-prd.md` §4.6, §4.11, §6
  - SDK/Client: none installed (`@anthropic-ai/*` or equivalent not present)
  - Rules: outputs labeled AI-generated until clinician approval; provider isolated behind an abstraction; never hard-code one vendor into business logic; AI calls logged - `AGENTS.md` §40; `docs/clinic-management-prd.md` §4.11

**Drug / clinical reference data *(documented intent, open sourcing question)*:**
- India-specific drug database (brand + generic + salt composition) for prescription drug search and interaction/allergy warnings - `docs/clinic-management-prd.md` §4.5
- ICD-10 diagnosis coding with ICD-11 readiness for auto-suggested diagnoses - `docs/clinic-management-prd.md` §4.6
- Local configurable lab test catalog - `docs/clinic-management-prd.md` §4.7
  - Vendor/API: **unselected** — "will need a licensed India drug database (e.g., a commercial API)" is an open question - `docs/clinic-management-prd.md` §9.3

**Payments *(documented intent, open question)*:**
- SaaS subscription billing for the ₹1,000/month clinic plan — Razorpay or similar assumed, **not confirmed** - `docs/clinic-management-prd.md` §9.2, §4.1
- Patient payment handling at launch is **record-only** (cash/UPI/card recorded manually, no gateway) - `docs/clinic-management-prd.md` §4.10
  - When a gateway is added: must sit behind a provider abstraction, use idempotency, never store raw card details - `AGENTS.md` §19, §41, §42

**Public API / webhooks *(documented intent, not implemented)*:**
- API-first REST surface over core entities (patients, appointments, visits, prescriptions, lab orders, referrals) intended for web/mobile clients and a future AI Voice Agent - `docs/clinic-management-prd.md` §4.12
- Auth via tenant-scoped API keys / OAuth2 with role-scoped permissions; rate limiting and usage logging per tenant/API key - `docs/clinic-management-prd.md` §4.12
- Webhooks for key events (appointment booked/cancelled, visit completed, lab result ready) - `docs/clinic-management-prd.md` §4.12

**Compliance / health ID *(design-now, integrate-later)*:**
- ABDM/ABHA/UHI integration explicitly **out of scope at launch**; only data-layer readiness (nullable ABHA fields, ICD/FHIR-mappable structures, immutable consent records) - `docs/clinic-management-prd.md` §4.13, §10
  - No ABDM SDK/client present or required today.

## Data Storage

**Databases:**
- *(none on disk)* — no migrations, SQL files, ORM config, or DB client code exists anywhere in the repo.
- Documented intent: **Supabase (Postgres)** with Row Level Security as a mandatory tenant-isolation boundary; connection via environment variables (none defined yet); access centralized in `lib/supabase/` plus feature-level data-access modules - `AGENTS.md` §5
  - Supabase project region should be India-based or nearest compliant region (DPDP Act) — still to be confirmed - `docs/clinic-management-prd.md` §9.5
  - Avoid coupling domain logic to Supabase-specific APIs to preserve migration path (future AWS/GCP/Azure India regions) - `AGENTS.md` §5; `docs/clinic-management-prd.md` §5.1, §6
  - SQLite explicitly forbidden as the app database - `AGENTS.md` §5

**File Storage:**
- *(none on disk)* — no storage client code.
- Documented intent: Supabase Storage for attachments (patient documents, scanned reports, generated PDFs), abstracted behind an interface rather than called directly everywhere; controlled/signed URLs, auth checked on every file access - `AGENTS.md` §21; `docs/clinic-management-prd.md` §6

**Caching:**
- None (no Redis, no CDN config, no cache layer) — and none documented as required; `AGENTS.md` §44 requires explicit key/scope/TTL/invalidation if caching is ever introduced.

## Authentication & Identity

**Auth Provider:**
- *(none on disk)* — no auth code, no session/cookie handling, no middleware.
- Documented intent: **Supabase Auth** via `@supabase/ssr` cookie-based SSR sessions (short-lived access, HttpOnly cookies, Secure in production, SameSite, CSRF protection where applicable) - `AGENTS.md` §5, §8
- Staff login: **OTP-based** onboarding/login per staff account (phone/email invite); no shared clinic logins - `docs/clinic-management-prd.md` §4.1, §5.3
- Authorization: server-side RBAC (Owner/Admin, Doctor, Nurse, Receptionist, Billing, Clinic Admin) — UI hiding is not authorization - `AGENTS.md` §8; role model in `docs/clinic-management-prd.md` §4.1

## Monitoring & Observability

**Error Tracking:**
- None configured (no Sentry/Datadog/etc. config or dependency). Documented requirement only: error reporting + structured logs with request/correlation IDs - `AGENTS.md` §33.

**Logs:**
- None implemented. Rules that will apply: structured logs; never log clinical notes, passwords, tokens, or sensitive personal data - `AGENTS.md` §12, §33
- Audit logging (actor, tenant, action, target, outcome) is a first-class data requirement, not an integration - `AGENTS.md` §10; `docs/clinic-management-prd.md` §5.3

**Health Checks / Metrics / Alerting:**
- None implemented; required before production readiness - `AGENTS.md` §34, §46.

## CI/CD & Deployment

**Hosting:**
- Not deployed. No `Dockerfile`, no `docker-compose.yml`, no `vercel.json`, no IaC.
- Documented intent: **Vercel** for the Next.js app layer; Supabase managed backups; GitHub-based CI/CD; HTTPS everywhere outside local dev - `AGENTS.md` §5; `docs/clinic-management-prd.md` §6

**CI Pipeline:**
- None — `.github/` directory does not exist. Documented intent: GitHub-based CI/CD running lint, typecheck, tests, migration checks - `AGENTS.md` §5, §28.

## Environment Configuration

**Required env vars:**
- None defined today — no `.env`, `.env.*`, or `.env.example` anywhere in the repo.
- At scaffold time, `AGENTS.md` §32 requires a committed `.env.example`; expected categories based on documented intent: Supabase URL/anon key (+ service-role key kept server-only), WhatsApp/SMS provider credentials, LLM API key, payment provider keys, app URL/origin. Exact variable names are not yet fixed by any document in the repo.
- Never expose service-role credentials to the browser - `AGENTS.md` §5.

**Secrets location:**
- None stored. Documented intent: Vercel environment variables for application secrets; never commit API keys/tokens/private keys - `AGENTS.md` §5, §32.

## Webhooks & Callbacks

**Incoming:**
- None — no route handlers or endpoint code exists.
- Documented intent: none inbound today; future ABDM consent-manager integration is explicitly deferred (`docs/clinic-management-prd.md` §4.13).

**Outgoing:**
- None implemented. Documented intent: outbound webhooks for appointment booked/cancelled, visit completed, lab result ready — targeted at the future AI Voice Agent and third-party integrations, with per-tenant API keys, rate limiting, and usage logging - `docs/clinic-management-prd.md` §4.12.

---

*Integration audit: 2026-10-06*
