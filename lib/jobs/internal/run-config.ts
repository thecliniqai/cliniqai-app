/**
 * The production runner pass configuration (V2-04 04-02, revised 04-07b for M-FAIR and review A L-3). `/api/jobs/run`
 * passes exactly these values to `runJobs`, and the fairness and budget specs drive the real runner with them.
 *
 * - `budgetMs` 25 s: the window in which the pass starts work (pg_net waits 30 s for the response). A job starts only if
 *   its handler bound plus margins still fits (runner `jobCostMs`), so a 12 s message send starts with ≥ 13.5 s left.
 * - `batch` 10 / `perTenant` 5: each claim takes up to 10 due jobs, round-robin across the least recently served
 *   tenants (04-07d, N-1: migration 000044 rotates through every tenant with due work, so a clinic is served within
 *   ceil(tenants with due work / 10) claims) and at most 5 from one tenant, so one clinic's backlog never fills a batch
 *   while another clinic has due work.
 *   Jobs of a batch that no longer fit the budget are handed back unstarted (no attempt spent).
 * - `leaseSeconds` 120: far above the budget, so a live pass never loses a lease, and the time an abandoned handler
 *   (one that ignored its abort) keeps its job away from other runners.
 * - `rpcTimeoutMs` 4 s: hard bound per queue RPC. Worst case for one pass:
 *   begin T + budget + (start T + finish T of the last job) + parallel release T + end T = 25 + 5 × 4 = 45 s, under the
 *   route's 60 s `maxDuration` even when every RPC stalls to its bound.
 */
export const RUN_PASS_CONFIG = {
  budgetMs: 25_000,
  batch: 10,
  leaseSeconds: 120,
  perTenant: 5,
  rpcTimeoutMs: 4_000,
} as const;

/** The route's hard limit (Vercel Hobby `maxDuration`). */
export const ROUTE_MAX_DURATION_S = 60;
