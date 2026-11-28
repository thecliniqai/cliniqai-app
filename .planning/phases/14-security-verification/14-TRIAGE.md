# V2-14 triage

Findings from the scanners and reviews of V2-14 (plan "Shared rules"). Status: Open / Fixed / Verified / Risk-accepted.
Severity is the finding's in this application, not the scanner's label. Lane 14a rows below; 14-03..14-05 append.

| SEC id | Source | Finding | Severity | Status | Proof / disposition | Commit |
|---|---|---|---|---|---|---|
| SEC-14-001 | Semgrep `postgrest-or-interpolation` (custom) | `/api/v1/visits` interpolated `start_date`/`end_date` unchecked into a PostgREST `.or()` filter string (filter injection; the outer `.eq("tenant_id")` kept it inside the key's tenant). `/api/v1` is off by default (PO-16). | Low | Fixed | `isIsoDateParam` before the filter (422 otherwise); tests/security/filters.spec.ts; tests/api/v1-error-texts.spec.ts keeps the fixed 422 text | lane 14a |
| SEC-14-002 | Semgrep `postgrest-or-interpolation` | The receipt lookup (`compileReceiptPayload`) relied on its callers to check the id; the public share path passes a token's object id | Info | Fixed | `isUuid` inside `compileReceiptPayload` (defence in depth) | lane 14a |
| SEC-14-003 | Semgrep `postgrest-or-interpolation` | 15 more interpolated `.or()` calls: session values (notifications), `isUuid`-checked ids, `SPECIALTY_SLUG`-checked specialty, computed day windows | Info | Verified | Each carries `nosemgrep: postgrest-or-interpolation -- <validation>` | lane 14a |
| SEC-14-004 | Semgrep `admin-query-without-tenant` | Messaging webhook resolves the queue row by the provider's correlation id without a tenant (the tenant is read from the matched row; P0-03) | Info | Verified | `nosemgrep` with the reason; primary-key reads are out of the rule's scope (14-NOTES D-14a-8) | lane 14a |
| SEC-14-005 | OSV-Scanner | Production highs `GHSA-mrhx-c7xc-m3w5` (zod 3) and `GHSA-j4fx-xxwh-2485` (jsondiffpatch via ai@4) | High (scanner) / Low (app: AI off, bounded inputs) | Risk-accepted | Existing waivers in `.github/audit-allowlist.json` (owner V2-12 P1-19, expire 2027-02-10); the OSV gate honours them | — |
| SEC-14-006 | OSV-Scanner | Dev-only criticals/highs: tinypool 1.1.1 (vitest), basic-ftp 5.3.1, extract-zip 2.0.1, tmp 0.0.33/0.1.0 (Lighthouse CI / Puppeteer chain), uuid 8.3.2 | Low (CI tooling only, synthetic data, no untrusted input) | Open | Report only by D-14a-9; bump with the vitest 3→4 and LHCI upgrades (V2-15 tooling) | — |
| SEC-14-007 | Semgrep community `react-insecure-request` | `scripts/security/zap-local.mjs` polls `http://127.0.0.1:3100` | Info | Verified | Loopback e2e server by design; `nosemgrep` at the line | lane 14a |
| SEC-14-008 | Plan D-8 | An upload page accepted any declared body size from a signed-in caller up to Next's 4 MB action limit | Low | Fixed | `declaredBodyExceedsUploadLimit` (413 above 4.5 MB before session work); tests/api/proxy-body-limit.spec.ts | lane 14a |
| SEC-14-009 | P1-18 | No CSP, Referrer-Policy, Permissions-Policy, COOP or HSTS on app pages | Medium | Fixed | Nonce CSP + headers (lib/security/headers.ts, proxy.ts, next.config.ts); tests/security/csp-headers.spec.ts; tests/e2e/security/csp.spec.ts (injected inline script blocked); zero-violation check on the whole PR lane (tests/e2e/fixtures.ts) | lane 14a |

ZAP baseline and `supabase db lint` / `db advisors` rows are added from the first CI run of lane 14a (artefacts
`zap-baseline`, job logs).
