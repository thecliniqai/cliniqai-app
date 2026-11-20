/**
 * V2-07 07-00 (R-10, PWA-06a): the client command runner behind `useCommand` (`lib/commands/use-command.ts`).
 *
 * One `client_request_id` per logical submit: the same id on every retry after a failure (so a lost response that hid
 * a commit is replayed, not repeated), a new one after a success; busy while in flight; app error codes forwarded.
 * The rules live in `createCommandRunner` (no React), driven here with a counting id source and the real dirty guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appError, type Result } from "@/lib/errors/app-error";
import {
  COMMAND_RETRY_DELAY_MS,
  COMMAND_TIMEOUT_MS,
  createCommandRunner,
  newClientRequestId,
  type CommandRunnerDeps,
} from "@/lib/commands/use-command";
import { isBusy, registerBusy, resetDirtyGuardForTests } from "@/lib/pwa/dirty-guard";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A manual clock: timers (the 15 s timeout, the 1 s retry pause) fire only when the test advances time. */
function manualClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    schedule(fn: () => void, ms: number) {
      const key = ++seq;
      timers.set(key, { at: now + ms, fn });
      return () => void timers.delete(key);
    },
    sleep(ms: number) {
      return new Promise<void>((resolve) => this.schedule(resolve, ms));
    },
    async advance(ms: number) {
      const to = now + ms;
      for (;;) {
        await flush();
        const due = [...timers.entries()].filter(([, t]) => t.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = to;
      await flush();
    },
    get pendingTimers() {
      return timers.size;
    },
  };
}

/**
 * Most tests only care about the id and outcome rules, so the retry pause is instant and the timeout never fires.
 * Pass `clock` to drive time by hand, `online: false` for a device without a connection.
 */
function setup(options: { clock?: ReturnType<typeof manualClock>; online?: boolean } = {}) {
  let n = 0;
  const codes: string[] = [];
  const clock = options.clock;
  const deps: CommandRunnerDeps = {
    newId: () => `id-${++n}`,
    registerBusy,
    onAppErrorCode: (code) => void codes.push(code),
    isOnline: () => options.online ?? true,
    schedule: clock ? (fn, ms) => clock.schedule(fn, ms) : () => () => {},
    sleep: clock ? (ms) => clock.sleep(ms) : () => Promise.resolve(),
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
    // DEPENDENCY_FAILED is sent once more automatically (V2-08 R-20), with the same id.
    expect((await runner.run(call([fail("DEPENDENCY_FAILED"), fail("DEPENDENCY_FAILED")]))).ok).toBe(false);
    expect(await runner.run(call([ok(1)]))).toEqual({ ok: true, value: 1 });
    expect(sent).toEqual(["id-1", "id-1", "id-1", "id-1"]);

    // Success rotated it: the next submit is a new request.
    await runner.run(call([ok(2)]));
    expect(sent[4]).toBe("id-2");
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
    // The automatic retry (one more call, same id) failed as well; the next submit reuses the id again.
    expect(sent).toEqual(["id-1", "id-1"]);
    await runner.run(async (id) => (sent.push(id), ok(1)));
    expect(sent).toEqual(["id-1", "id-1", "id-1"]);
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

  describe("an unknown outcome keeps the id until the state is reloaded (V2-07 07-04a F-13)", () => {
    // A committed-but-lost payment, then the user edits the form: a new id would record a second, different payment.
    it.each([
      // Transport failures are sent twice (the automatic retry); INTERNAL is never retried.
      ["a thrown network error", async () => { throw new Error("fetch failed"); }, 2],
      ["DEPENDENCY_FAILED", async () => fail("DEPENDENCY_FAILED"), 2],
      ["INTERNAL", async () => fail("INTERNAL"), 1],
    ])("after %s, reset() keeps the id and unresolved stays true", async (_name, lost, attempts) => {
      const { runner } = setup();
      const sent: string[] = [];
      await runner.run<number>(async (id) => (sent.push(id), lost()));
      expect(sent).toHaveLength(attempts);
      expect(runner.unresolved).toBe(true);
      runner.reset();
      expect(runner.currentId()).toBe("id-1");
      await runner.run(async (id) => (sent.push(id), fail("CONFLICT")));
      expect(sent).toEqual(Array(attempts + 1).fill("id-1"));
    });

    it("settle() (the form reloaded the state) lets the next reset() issue a new id; the id itself is kept until then", async () => {
      const { runner } = setup();
      await runner.run<number>(async () => fail("INTERNAL"));
      runner.reset();
      expect(runner.currentId()).toBe("id-1");
      runner.settle();
      expect(runner.unresolved).toBe(false);
      expect(runner.currentId()).toBe("id-1");
      runner.reset();
      expect(runner.currentId()).toBeNull();
    });

    it("startOver() (the user abandons the submit) releases the id at once, and is ignored while a call is in flight", async () => {
      const { runner } = setup();
      await runner.run<number>(async () => fail("DEPENDENCY_FAILED"));
      runner.startOver();
      expect(runner.currentId()).toBeNull();
      expect(runner.unresolved).toBe(false);

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const inFlight = runner.run(async () => (await gate, fail("INTERNAL")));
      runner.startOver();
      expect(runner.currentId()).toBe("id-2");
      release();
      await inFlight;
      expect(runner.unresolved).toBe(true);
    });

    it("a known refusal (CONFLICT, VALIDATION_FAILED) is not unresolved: an edit after it is a new request", async () => {
      const { runner } = setup();
      await runner.run<number>(async () => fail("DEPENDENCY_FAILED"));
      await runner.run<number>(async () => fail("CONFLICT")); // the retry got a definite answer
      expect(runner.unresolved).toBe(false);
      runner.reset();
      expect(runner.currentId()).toBeNull();
    });

    it("a success after an unknown outcome clears it and rotates the id", async () => {
      const { runner } = setup();
      await runner.run<number>(async () => fail("INTERNAL"));
      expect((await runner.run(async () => ok(1))).ok).toBe(true);
      expect(runner.unresolved).toBe(false);
      expect(runner.currentId()).toBeNull();
    });
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

describe("timeout, automatic retry and offline (V2-08 08-01a, F-9, PWA-06b, R-20)", () => {
  it("exports the 15 s timeout and the 1 s pause", () => {
    expect(COMMAND_TIMEOUT_MS).toBe(15_000);
    expect(COMMAND_RETRY_DELAY_MS).toBe(1_000);
  });

  it("a call that has not answered at 15 s times out, is retried once after 1 s with the same id, and the retry's success is the result", async () => {
    const clock = manualClock();
    const { runner, ids } = setup({ clock });
    const sent: string[] = [];
    let first = true;
    const result = runner.run<number>(async (id) => {
      sent.push(id);
      if (first) {
        first = false;
        return new Promise<Result<number>>(() => {}); // never answers
      }
      return ok(7);
    });
    await clock.advance(COMMAND_TIMEOUT_MS - 1);
    expect(sent).toEqual(["id-1"]);
    expect(runner.inFlight).toBe(true);
    await clock.advance(1); // timed out; waiting out the pause
    expect(sent).toEqual(["id-1"]);
    await clock.advance(COMMAND_RETRY_DELAY_MS);
    expect(await result).toEqual({ ok: true, value: 7 });
    expect(sent).toEqual(["id-1", "id-1"]); // one id used twice
    expect(ids()).toBe(1);
    expect(runner.unresolved).toBe(false);
    expect(runner.currentId()).toBeNull();
    expect(clock.pendingTimers).toBe(0);
  });

  it("two transport failures end as an unresolved DEPENDENCY_FAILED; retry (a new run of the same call) reuses the id", async () => {
    const clock = manualClock();
    const { runner, codes } = setup({ clock });
    const sent: string[] = [];
    const lose = async (id: string): Promise<Result<number>> => (sent.push(id), Promise.reject(new Error("fetch failed")));
    const first = runner.run(lose);
    await clock.advance(COMMAND_RETRY_DELAY_MS);
    expect(await first).toMatchObject({ ok: false, error: { code: "DEPENDENCY_FAILED" } });
    expect(sent).toEqual(["id-1", "id-1"]);
    expect(runner.unresolved).toBe(true);
    expect(codes).toEqual(["DEPENDENCY_FAILED"]); // reported once, after the retry
    expect(runner.currentId()).toBe("id-1");

    const again = runner.run(async (id) => (sent.push(id), ok(1)));
    expect(await again).toEqual({ ok: true, value: 1 });
    expect(sent).toEqual(["id-1", "id-1", "id-1"]);
    expect(runner.unresolved).toBe(false);
  });

  it("two timeouts report reason TIMEOUT, outcome unknown, id kept", async () => {
    const clock = manualClock();
    const { runner } = setup({ clock });
    const sent: string[] = [];
    const result = runner.run<number>((id) => (sent.push(id), new Promise<Result<number>>(() => {})));
    await clock.advance(COMMAND_TIMEOUT_MS + COMMAND_RETRY_DELAY_MS + COMMAND_TIMEOUT_MS);
    expect(await result).toMatchObject({ ok: false, error: { code: "DEPENDENCY_FAILED", reason: "TIMEOUT" } });
    expect(sent).toEqual(["id-1", "id-1"]);
    expect(runner.unresolved).toBe(true);
    expect(runner.currentId()).toBe("id-1");
    expect(runner.inFlight).toBe(false);
  });

  it.each(["VALIDATION_FAILED", "CONFLICT", "FORBIDDEN", "NOT_FOUND", "IDEMPOTENCY_MISMATCH", "UNAUTHENTICATED", "SUBSCRIPTION_LOCKED", "INTERNAL"] as const)(
    "%s is a definite answer: it is never retried automatically",
    async (code) => {
      const { runner } = setup();
      const sent: string[] = [];
      const result = await runner.run<number>(async (id) => (sent.push(id), fail(code)));
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(sent).toHaveLength(1);
    },
  );

  it("the late answer of a timed-out attempt is ignored: the retry's answer is the result", async () => {
    const clock = manualClock();
    const { runner } = setup({ clock });
    const answers: Array<(r: Result<string>) => void> = [];
    const result = runner.run<string>(() => new Promise<Result<string>>((resolve) => answers.push(resolve)));
    await clock.advance(COMMAND_TIMEOUT_MS + COMMAND_RETRY_DELAY_MS); // attempt 1 timed out; attempt 2 sent
    expect(answers).toHaveLength(2);
    answers[0](fail("CONFLICT")); // the superseded attempt answers late: ignored
    answers[1](ok("second"));
    expect(await result).toEqual({ ok: true, value: "second" });
    expect(runner.unresolved).toBe(false);
  });

  it("an answer that arrives after the timeout but before the retry is not used either; the retry decides", async () => {
    const clock = manualClock();
    const { runner } = setup({ clock });
    const answers: Array<(r: Result<string>) => void> = [];
    const result = runner.run<string>(() => new Promise<Result<string>>((resolve) => answers.push(resolve)));
    await clock.advance(COMMAND_TIMEOUT_MS); // timed out, pausing
    answers[0](ok("late")); // ignored
    await clock.advance(COMMAND_RETRY_DELAY_MS);
    expect(answers).toHaveLength(2);
    answers[1](fail("CONFLICT"));
    expect(await result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("offline at submit sends nothing, spends no id and reports reason OFFLINE", async () => {
    const { runner, ids, codes } = setup({ online: false });
    const call = vi.fn(async () => ok(1));
    const result = await runner.run(call);
    expect(call).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "DEPENDENCY_FAILED", reason: "OFFLINE" } });
    expect(ids()).toBe(0);
    expect(runner.currentId()).toBeNull();
    expect(runner.unresolved).toBe(false);
    expect(runner.inFlight).toBe(false);
    expect(codes).toEqual([]);
    expect(isBusy()).toBe(false);
  });

  it("stays busy with the update guard for the whole span, the pause and the retry included", async () => {
    const clock = manualClock();
    const { runner } = setup({ clock });
    const busy: boolean[] = [];
    const result = runner.run<number>(async () => (busy.push(isBusy()), fail("DEPENDENCY_FAILED")));
    await clock.advance(1);
    busy.push(isBusy()); // in the pause
    await clock.advance(COMMAND_RETRY_DELAY_MS);
    await result;
    expect(busy).toEqual([true, true, true]);
    expect(isBusy()).toBe(false);
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
