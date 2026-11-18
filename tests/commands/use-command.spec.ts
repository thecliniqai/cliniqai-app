/**
 * V2-07 07-00 (R-10, PWA-06a): the client command runner behind `useCommand` (`lib/commands/use-command.ts`).
 *
 * One `client_request_id` per logical submit: the same id on every retry after a failure (so a lost response that hid
 * a commit is replayed, not repeated), a new one after a success; busy while in flight; app error codes forwarded.
 * The rules live in `createCommandRunner` (no React), driven here with a counting id source and the real dirty guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appError, type Result } from "@/lib/errors/app-error";
import { createCommandRunner, newClientRequestId, type CommandRunnerDeps } from "@/lib/commands/use-command";
import { isBusy, registerBusy, resetDirtyGuardForTests } from "@/lib/pwa/dirty-guard";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup() {
  let n = 0;
  const codes: string[] = [];
  const deps: CommandRunnerDeps = {
    newId: () => `id-${++n}`,
    registerBusy,
    onAppErrorCode: (code) => void codes.push(code),
  };
  return { runner: createCommandRunner(deps), codes, ids: () => n };
}

const fail = (code: Parameters<typeof appError>[0]): Result<never> => ({ ok: false, error: appError(code) });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

beforeEach(() => resetDirtyGuardForTests());

describe("createCommandRunner", () => {
  it("sends one id for a submit, the same id on every retry after an error, and a new id after a success", async () => {
    const { runner } = setup();
    const sent: string[] = [];
    const call = (results: Array<Result<number>>) => async (id: string) => {
      sent.push(id);
      return results.shift() as Result<number>;
    };

    expect((await runner.run(call([fail("CONFLICT")]))).ok).toBe(false);
    expect((await runner.run(call([fail("DEPENDENCY_FAILED")]))).ok).toBe(false);
    expect(await runner.run(call([ok(1)]))).toEqual({ ok: true, value: 1 });
    expect(sent).toEqual(["id-1", "id-1", "id-1"]);

    // Success rotated it: the next submit is a new request.
    await runner.run(call([ok(2)]));
    expect(sent[3]).toBe("id-2");
    expect(runner.currentId()).toBeNull();
  });

  it("a thrown error (lost response) is a DEPENDENCY_FAILED result that keeps the id, so the retry can replay", async () => {
    const { runner, codes } = setup();
    const sent: string[] = [];
    const lost = await runner.run<number>(async (id) => {
      sent.push(id);
      throw new Error("fetch failed");
    });
    expect(lost).toMatchObject({ ok: false, error: { code: "DEPENDENCY_FAILED" } });
    expect(JSON.stringify(lost)).not.toContain("fetch failed");
    expect(codes).toEqual(["DEPENDENCY_FAILED"]);
    await runner.run(async (id) => (sent.push(id), ok(1)));
    expect(sent).toEqual(["id-1", "id-1"]);
  });

  it("IDEMPOTENCY_MISMATCH retires the id (it belongs to another request); the next submit is new", async () => {
    const { runner } = setup();
    const sent: string[] = [];
    await runner.run(async (id) => (sent.push(id), fail("IDEMPOTENCY_MISMATCH")));
    expect(runner.currentId()).toBeNull();
    await runner.run(async (id) => (sent.push(id), ok(1)));
    expect(sent).toEqual(["id-1", "id-2"]);
  });

  it("reset() starts a new submit after an error (the inputs changed); it never changes an id in flight", async () => {
    const { runner } = setup();
    const sent: string[] = [];
    await runner.run(async (id) => (sent.push(id), fail("VALIDATION_FAILED")));
    runner.reset();
    expect(runner.currentId()).toBeNull();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inFlight = runner.run(async (id) => {
      sent.push(id);
      await gate;
      return fail("CONFLICT");
    });
    runner.reset(); // ignored: a call is running
    release();
    await inFlight;
    await runner.run(async (id) => (sent.push(id), ok(1)));
    expect(sent).toEqual(["id-1", "id-2", "id-2"]);
  });

  it("a second run while one is in flight returns the first call's result and sends nothing (a double click)", async () => {
    const { runner } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const call = vi.fn(async () => {
      await gate;
      return ok("first");
    });
    const first = runner.run(call);
    const second = runner.run(vi.fn(async () => ok("second")));
    expect(runner.inFlight).toBe(true);
    release();
    expect(await first).toEqual({ ok: true, value: "first" });
    expect(await second).toEqual({ ok: true, value: "first" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(runner.inFlight).toBe(false);
  });

  it("the call is registered busy with the update guard while in flight, and released on success, failure and a throw", async () => {
    const { runner } = setup();
    let seen: boolean | undefined;
    await runner.run(async () => ((seen = isBusy()), ok(1)));
    expect(seen).toBe(true);
    expect(isBusy()).toBe(false);

    await runner.run(async () => ((seen = isBusy()), fail("CONFLICT")));
    expect(seen).toBe(true);
    expect(isBusy()).toBe(false);

    await runner.run(async () => {
      throw new Error("boom");
    });
    expect(isBusy()).toBe(false);
  });

  it("only a failed result reaches onAppErrorCode (a locked clinic or an expired session reacts); a success never does", async () => {
    const { runner, codes } = setup();
    await runner.run(async () => ok(1));
    expect(codes).toEqual([]);
    await runner.run(async () => fail("SUBSCRIPTION_LOCKED"));
    await runner.run(async () => fail("UNAUTHENTICATED"));
    expect(codes).toEqual(["SUBSCRIPTION_LOCKED", "UNAUTHENTICATED"]);
  });
});

describe("newClientRequestId", () => {
  const original = globalThis.crypto;
  afterEach(() => vi.stubGlobal("crypto", original));

  it("is a UUID v4, different every time", () => {
    const a = newClientRequestId();
    expect(a).toMatch(UUID_V4);
    expect(newClientRequestId()).not.toBe(a);
  });

  it("still makes a UUID v4 where randomUUID is unavailable (an insecure context)", () => {
    vi.stubGlobal("crypto", { getRandomValues: original.getRandomValues.bind(original) });
    expect(newClientRequestId()).toMatch(UUID_V4);
  });
});
