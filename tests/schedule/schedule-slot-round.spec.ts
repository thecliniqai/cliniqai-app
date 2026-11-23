/**
 * V2-09d 09D-01a (A-11): the Schedule read model sends every `available_slots` call of a week view, the day grid's and the
 * week strip's, before it awaits any of them (one round of latency, not two), and asks a (doctor, date) pair the two
 * share once. The slot adapter, the doctor directory and the zone are fakes that record when each call starts; the rest of
 * the read model's reads answer empty. Synthetic ids only.
 */
import { describe, expect, it, vi } from "vitest";

const slots = vi.hoisted(() => ({
  started: [] as string[],
  release: [] as Array<() => void>,
}));

vi.mock("@/features/visits/scheduling-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/visits/scheduling-service")>();
  return {
    ...actual,
    getAvailableSlots: (_ctx: unknown, doctorId: string, date: string) => {
      slots.started.push(`${doctorId}|${date}`);
      return new Promise((resolve) => slots.release.push(() => resolve({ ok: true, value: [] })));
    },
  };
});

const DOCTOR_A = "00000000-0000-4000-8000-0000000000a1";
const DOCTOR_B = "00000000-0000-4000-8000-0000000000a2";

vi.mock("@/features/staff/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/staff/service")>();
  return {
    ...actual,
    getTenantDoctorDirectory: async () => [
      { id: DOCTOR_A, name: "Synthetic Doctor A", specialty: null },
      { id: DOCTOR_B, name: "Synthetic Doctor B", specialty: null },
    ],
  };
});

vi.mock("@/lib/datetime/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/datetime/server")>();
  return { ...actual, getTenantTimeZone: async () => "Asia/Kolkata" };
});

import { getSchedule } from "@/features/schedule/queries";
import type { ServiceContext } from "@/lib/auth/context";

/** A query builder that accepts any chain and answers an empty list. */
function emptyQuery(): unknown {
  const answer = Promise.resolve({ data: [], error: null, count: 0 });
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? answer.then.bind(answer) : () => chain),
    apply: () => chain,
  });
  return chain;
}

const ctx = {
  userId: "00000000-0000-4000-8000-0000000000b1",
  tenantId: "00000000-0000-4000-8000-0000000000b2",
  role: "receptionist",
  actorType: "user",
  db: { from: () => emptyQuery(), rpc: () => emptyQuery() },
} as unknown as ServiceContext;

describe("A-11: a week view's slot calls go out in one round", () => {
  it("the day grid's and the week strip's calls all start before any answers; the shared (doctor, date) is asked once", async () => {
    // Wednesday 2026-11-25 (its week: Mon 23 .. Sun 29).
    const pending = getSchedule(ctx, { date: "2026-11-25", week: true, now: new Date("2026-11-25T03:00:00Z") });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 2 doctors on the day + doctor A's 7 days, the Wednesday shared: 8 calls, all in flight with none answered.
    expect(slots.started).toHaveLength(8);
    expect(new Set(slots.started).size).toBe(8);
    expect(slots.started).toContain(`${DOCTOR_B}|2026-11-25`);
    expect(slots.started.filter((k) => k === `${DOCTOR_A}|2026-11-25`)).toHaveLength(1);
    for (const release of slots.release) release();
    const result = await pending;
    expect(result.ok).toBe(true);
  });
});
