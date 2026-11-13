/**
 * V2-04 04-01 (P0-12, T-04-07, T-04-09): lease expiry, fencing, backoff, dead letters and the reaper on the live local
 * queue (migration 000031). Time is moved by rewriting `locked_until` in SQL, never by sleeping.
 *
 * - An expired lease is re-claimed: same id, `attempts = 2`, a new token, `last_lease_expired_at` set.
 * - Fencing: the first (stale) token's `complete_job` returns false and changes nothing; the second token completes.
 * - The reaper dead-letters an expired lease with no attempts left (`lease_expired`); such a row is never re-claimed.
 * - `fail_job`: retryable on attempt 1 → pending in [15 s, 30 s]; retryable on the last attempt → dead;
 *   non-retryable → dead at once; a handler retry time is honoured; a stale token → `stale`.
 * - `release_job` returns the claim's attempt; a free-text code (synthetic phone) is never stored.
 */
import { afterAll, describe, expect, it } from "vitest";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import {
  deleteJobs,
  deleteTenants,
  enqueueMany,
  insertTenant,
  jobRows,
  letters,
  uniqueKind,
} from "./helpers";

const WORKER = `spec-reaper-${letters(8)}`;
const kinds: string[] = [];
const tenantId = insertTenant(`reaper ${letters(6)}`);

afterAll(() => {
  deleteJobs(kinds);
  deleteTenants([tenantId]);
});

function kind(word: string): string {
  const k = uniqueKind(word);
  kinds.push(k);
  return k;
}

async function claim(k: string, leaseSeconds = 60) {
  const { data, error } = await getAdminClient().rpc("claim_jobs", {
    p_kinds: [k],
    p_batch: 10,
    p_lease_seconds: leaseSeconds,
    p_worker: WORKER,
  });
  expect(error).toBeNull();
  return data ?? [];
}

async function complete(id: string, token: string): Promise<boolean | null> {
  const { data, error } = await getAdminClient().rpc("complete_job", {
    p_id: id,
    p_lease_token: token,
  });
  expect(error).toBeNull();
  return data;
}

async function fail(
  id: string,
  token: string,
  code: string,
  retryable: boolean,
  retryAt?: string
) {
  const { data, error } = await getAdminClient().rpc("fail_job", {
    p_id: id,
    p_lease_token: token,
    p_error_code: code,
    p_retryable: retryable,
    ...(retryAt ? { p_retry_at: retryAt } : {}),
  });
  expect(error).toBeNull();
  return data;
}

/** Moves a job's lease into the past (the "runner crashed and the lease ran out" state, without waiting). */
function expireLease(id: string): void {
  psql(
    `update ops.jobs set locked_until = now() - interval '1 second' where id = '${id}'`
  );
}

function column(id: string, expr: string): string {
  return psql(`select ${expr} from ops.jobs where id = '${id}'`)[0];
}

describe("lease expiry and fencing", () => {
  it("an expired lease is re-claimed with attempts = 2 and a new token; the stale holder cannot complete it", async () => {
    const k = kind("lease");
    const [id] = enqueueMany(k, tenantId, 1);

    const [first] = await claim(k, 10);
    expect(first).toMatchObject({ id, attempts: 1 });
    expect(await claim(k)).toEqual([]); // leased: nobody else gets it
    expect(column(id, "last_lease_expired_at is null")).toBe("t");

    expireLease(id);
    const [second] = await claim(k);
    expect(second).toMatchObject({ id, attempts: 2 });
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(column(id, "last_lease_expired_at is not null")).toBe("t");

    // Fencing: the first runner wakes up and tries to finish. Nothing changes.
    expect(await complete(id, first.lease_token)).toBe(false);
    expect(await fail(id, first.lease_token, "late_failure", true)).toBe(
      "stale"
    );
    expect(column(id, "status || '|' || lease_token")).toBe(
      `running|${second.lease_token}`
    );

    expect(await complete(id, second.lease_token)).toBe(true);
    expect(jobRows(k)).toEqual([
      { id, status: "done", attempts: 2, lastError: null },
    ]);
    expect(
      column(
        id,
        "finished_at is not null and lease_token is null and locked_until is null"
      )
    ).toBe("t");
    // A second completion with the same token is also refused: done is terminal.
    expect(await complete(id, second.lease_token)).toBe(false);
  });

  it("the reaper dead-letters an expired lease with no attempts left, and it is never re-claimed", async () => {
    const k = kind("reap");
    const [id] = enqueueMany(k, tenantId, 1, { maxAttempts: 1 });
    const [first] = await claim(k, 10);
    expect(first).toMatchObject({ id, attempts: 1, max_attempts: 1 });

    expireLease(id);
    expect(await claim(k)).toEqual([]); // no attempts left: not claimable
    expect(Number(psql("select ops.reap_jobs()")[0])).toBeGreaterThanOrEqual(1);
    expect(jobRows(k)).toEqual([
      { id, status: "dead", attempts: 1, lastError: "lease_expired" },
    ]);
    expect(column(id, "finished_at is not null and lease_token is null")).toBe(
      "t"
    );
    expect(await complete(id, first.lease_token)).toBe(false);
  });

  it("the reaper leaves a live lease and an expired lease with attempts left alone", async () => {
    const k = kind("reaplive");
    const [live, expired] = enqueueMany(k, tenantId, 2, { maxAttempts: 3 });
    expect((await claim(k)).map((r) => r.id).sort()).toEqual(
      [live, expired].sort()
    );
    expireLease(expired);
    psql("select ops.reap_jobs()");
    expect(jobRows(k).map((r) => r.status)).toEqual(["running", "running"]);
  });
});

describe("fail_job: attempts, backoff and dead letters", () => {
  it("retryable on attempt 1 → pending, run_at 15–30 s later (30 s × [0.5, 1] jitter), lease cleared", async () => {
    const k = kind("retry");
    const [id] = enqueueMany(k, tenantId, 1);
    const [job] = await claim(k);
    expect(await fail(id, job.lease_token, "provider_timeout", true)).toBe(
      "pending"
    );
    expect(jobRows(k)).toEqual([
      { id, status: "pending", attempts: 1, lastError: "provider_timeout" },
    ]);
    const delay = Number(column(id, "extract(epoch from run_at - updated_at)"));
    expect(delay).toBeGreaterThanOrEqual(15);
    expect(delay).toBeLessThanOrEqual(30);
    expect(
      column(
        id,
        "lease_token is null and locked_until is null and finished_at is null"
      )
    ).toBe("t");
    expect(await claim(k)).toEqual([]); // not due yet
  });

  it("a handler's retry time is honoured (capped at one day)", async () => {
    const k = kind("retryat");
    const [id] = enqueueMany(k, tenantId, 1);
    const [job] = await claim(k);
    const at = psql("select (now() + interval '10 minutes')::text")[0];
    expect(await fail(id, job.lease_token, "rate_limited", true, at)).toBe(
      "pending"
    );
    expect(column(id, `run_at = '${at}'::timestamptz`)).toBe("t");

    psql(
      `update ops.jobs set run_at = now() - interval '1 second' where id = '${id}'`
    );
    const [again] = await claim(k);
    const far = psql("select (now() + interval '30 days')::text")[0];
    expect(await fail(id, again.lease_token, "rate_limited", true, far)).toBe(
      "pending"
    );
    expect(Number(column(id, "extract(epoch from run_at - updated_at)"))).toBe(
      86400
    );
  });

  it("retryable on the last attempt → dead with finished_at", async () => {
    const k = kind("last");
    const [id] = enqueueMany(k, tenantId, 1, { maxAttempts: 1 });
    const [job] = await claim(k);
    expect(await fail(id, job.lease_token, "provider_timeout", true)).toBe(
      "dead"
    );
    expect(jobRows(k)).toEqual([
      { id, status: "dead", attempts: 1, lastError: "provider_timeout" },
    ]);
    expect(column(id, "finished_at is not null")).toBe("t");
  });

  it("non-retryable → dead at once with attempts left", async () => {
    const k = kind("nonretry");
    const [id] = enqueueMany(k, tenantId, 1, { maxAttempts: 5 });
    const [job] = await claim(k);
    expect(await fail(id, job.lease_token, "invalid_payload", false)).toBe(
      "dead"
    );
    expect(jobRows(k)).toEqual([
      { id, status: "dead", attempts: 1, lastError: "invalid_payload" },
    ]);
  });

  it("attempts count up across retries until max_attempts, then dead (poison-pill bound)", async () => {
    const k = kind("poison");
    const [id] = enqueueMany(k, tenantId, 1, { maxAttempts: 3 });
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) {
      psql(
        `update ops.jobs set run_at = now() - interval '1 second' where id = '${id}' and status = 'pending'`
      );
      const [job] = await claim(k);
      expect(job.attempts).toBe(i + 1);
      outcomes.push((await fail(id, job.lease_token, "boom", true)) ?? "");
    }
    expect(outcomes).toEqual(["pending", "pending", "dead"]);
    expect(await claim(k)).toEqual([]);
  });

  it("stores a free-text error code as invalid_error_code (no message or number reaches last_error)", async () => {
    const k = kind("scrub");
    const [id] = enqueueMany(k, tenantId, 1);
    const [job] = await claim(k);
    const phone = ["+91", "90000", "00077"].join("");
    expect(
      await fail(id, job.lease_token, `send failed for ${phone}`, true)
    ).toBe("pending");
    expect(jobRows(k)[0].lastError).toBe("invalid_error_code");
    expect(
      psql(`select count(*) from ops.jobs where last_error like '%00077%'`)
    ).toEqual(["0"]);
  });
});

describe("release_job", () => {
  it("hands an unstarted job back: pending, attempt returned, re-claimable at once; the stale token is refused", async () => {
    const k = kind("release");
    const [id] = enqueueMany(k, tenantId, 1);
    const [job] = await claim(k);
    const { data, error } = await getAdminClient().rpc("release_job", {
      p_id: id,
      p_lease_token: job.lease_token,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(jobRows(k)).toEqual([
      { id, status: "pending", attempts: 0, lastError: null },
    ]);
    expect(column(id, "first_claimed_at is null and lease_token is null")).toBe(
      "t"
    );
    expect(
      (
        await getAdminClient().rpc("release_job", {
          p_id: id,
          p_lease_token: job.lease_token,
        })
      ).data
    ).toBe(false);
    const [again] = await claim(k);
    expect(again).toMatchObject({ id, attempts: 1 });
  });
});
