---
phase: 01A
roadmap_id: V2-01a
one_liner: Local-only Vitest lane on `supabase start` with a fail-closed env/network guard and run-scoped teardown; all existing suites run unchanged; AUTH-00 spike measured locally.
requirements: [P0-10, AUTH-00]
---

# Phase 01A (V2-01a) — summary

- **01a-01** `vitest.config.ts` no longer reads `.env`; `.env.test` (committed, no keys) + local `supabase-demo`
  keys from `supabase status`; guard in `tests/setup/test-env.ts` (config load, globalSetup, every worker, after
  imports); workers block non-loopback sockets/fetch, answer non-loopback DNS offline, refuse `.env*` loads.
  Playwright config uses the same guard.
- **01a-02** 69 existing spec files run unchanged on the local stack; one environment fix outside specs
  (`scripts/msg91-sync-templates.ts` loaded `.env` at import).
- **01a-03** `tests/setup/teardown.ts`: run lock, leak check first, storage → tenants (cascade) → users → verify.
- **01a-04** `01A-04-AUTH00-SPIKE.md` (isolated spike stack); A00-1…5 logged for PO ruling.
- `npm run test:db` added. Evidence: `01A-VERIFICATION.md`, `evidence/`.

**Deferred:** Playwright web server + browser network block (V2-02); `tsc` over `tests/` (E-7); AUTH-00 hosted
re-check (V2-03).
