"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appError, type AppError, type Result } from "@/lib/errors/app-error";
import { registerBusy } from "@/lib/pwa/dirty-guard";
import { onAppErrorCode } from "@/lib/pwa/lock";
import { clockOf } from "@/lib/datetime";
import { useClinicTimeZone } from "@/lib/datetime/client";
import { saveStateOf } from "@/lib/commands/save-state";
import type { SaveState } from "@/components/clinical/save-status";

/**
 * Client side of an atomic server command (V2-07 R-10, PWA-06a; TARGET_ARCHITECTURE §7.1).
 *
 * One logical submit = one `client_request_id`. The id is created on the first attempt and sent again when the same
 * submit is retried after a failure (a lost response may hide a commit; the server replays the first result for the
 * same id and writes nothing new). It is replaced only when the submit succeeded, or when the server says the id was
 * already used for a different request (`IDEMPOTENCY_MISMATCH`), or when the form calls {@link CommandRunner.reset}
 * (the user changed the inputs after an error, so the next submit is a new request).
 *
 * Unknown outcome (V2-07 07-04a F-13): after a failure that does not say whether the command committed (a thrown
 * network error or timeout, `DEPENDENCY_FAILED`, `INTERNAL`) the runner is `unresolved`. While it is, `reset()` does NOT
 * issue a new id: editing the form must not turn a possibly committed payment into a second, different one. The id is
 * released only by {@link CommandRunner.settle} (the form has reloaded the state and knows what happened) or
 * {@link CommandRunner.startOver} (the user explicitly abandons the submit), or when a retry succeeds or the server says
 * the id was used for another request.
 *
 * While a call is in flight it is registered with the dirty guard (`registerBusy`, PWA §3.7: the app never reloads
 * itself over a running command). A failed `Result` is passed to `onAppErrorCode` (a locked clinic triggers the status
 * check; an expired session signs out). A second `run` while one is in flight returns the first call's promise, so a
 * double click cannot send two commands. A thrown error (network, aborted request) is a failed Result with
 * `DEPENDENCY_FAILED` and keeps the id: the command may have committed, and the retry must find out.
 *
 * Timeout and retry (V2-08 08-01a, F-9, PWA §3.8, R-20): an attempt that has not settled after
 * {@link COMMAND_TIMEOUT_MS} becomes a failed Result (`DEPENDENCY_FAILED`, reason `TIMEOUT`, outcome unknown, id kept).
 * A thrown error, a timeout or `DEPENDENCY_FAILED` is sent once more with the same id after
 * {@link COMMAND_RETRY_DELAY_MS}; every other code is a definite answer and is never retried automatically. The answer of
 * an attempt that already timed out is ignored (the retry's answer is the one the form sees; the server replays by id).
 * Offline at submit (`navigator.onLine === false`) sends nothing and reports reason `OFFLINE`. The busy registration
 * covers the whole span, retry included.
 *
 * Limit of the Next client: server actions run through one queue, one at a time (`runRemainingActions` in
 * `next/dist/client/components/app-router-instance.js`). Our timeout frees the UI, but a retry sent while the first
 * request is still stalled only runs when that request ends. The idempotent id makes every ordering safe. Typeahead
 * must therefore not use server actions (R-11).
 *
 * {@link createCommandRunner} holds all the rules and has no React in it (`tests/commands/use-command.spec.ts`);
 * {@link useCommand} binds one runner to a component.
 */

/** A UUID v4. `randomUUID` needs a secure context; `getRandomValues` does not (moved from the checkout drawer). */
export function newClientRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** An attempt that has not settled after this long is a failed Result with reason `TIMEOUT` (R-20). */
export const COMMAND_TIMEOUT_MS = 15_000;
/** Pause before the single automatic retry (same id). */
export const COMMAND_RETRY_DELAY_MS = 1_000;

export interface CommandRunnerDeps {
  newId: () => string;
  registerBusy: () => () => void;
  onAppErrorCode: (code: string) => unknown;
  /** Defaults to `navigator.onLine !== false`. */
  isOnline?: () => boolean;
  /** Runs `fn` after `ms`; returns a function that cancels it. Defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Pause between the attempt and its retry. Defaults to a `setTimeout` promise. */
  sleep?: (ms: number) => Promise<void>;
}

const browserDeps: CommandRunnerDeps = {
  newId: newClientRequestId,
  registerBusy,
  onAppErrorCode: (code) => onAppErrorCode(code),
};

const defaultIsOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CommandRunner {
  /**
   * Runs one attempt of the command with this submit's `client_request_id`. `call` is the server action (or a thin
   * wrapper) and must send the id it is given.
   */
  run<T>(call: (clientRequestId: string) => Promise<Result<T>>): Promise<Result<T>>;
  /**
   * Starts a new logical submit: the next `run` uses a fresh id (call it when the user edits the inputs after an error).
   * A no-op while an attempt is in flight or while the outcome of the last attempt is unknown ({@link unresolved}).
   */
  reset(): void;
  /** The form has reloaded the server state after an unknown outcome: `reset()` may issue a new id again. The id is kept until then. */
  settle(): void;
  /** Explicitly abandons the current submit, whatever its outcome: the next `run` uses a fresh id. No-op while in flight. */
  startOver(): void;
  /** True after a failure whose outcome is unknown (see above) until `settle()`, `startOver()` or a success. */
  readonly unresolved: boolean;
  /** The id the next attempt will send, if a submit is open (after an error); null when the next `run` starts fresh. */
  currentId(): string | null;
  readonly inFlight: boolean;
}

/** Failure codes that do not say whether the command committed: the response may have been lost after the commit. */
const OUTCOME_UNKNOWN_CODES: readonly string[] = ["DEPENDENCY_FAILED", "INTERNAL"];

/** The text a form shows when the user changes a submit whose last attempt may have been saved (offers "Start over"). */
export const OUTCOME_UNKNOWN_MESSAGE =
  "The last attempt may have been saved. Check before adding it again, or choose Start over to enter it afresh.";

/** True for a failure code that does not say whether the command committed (a form reloads its state before it asks again). */
export function isOutcomeUnknownCode(code: string): boolean {
  return OUTCOME_UNKNOWN_CODES.includes(code);
}

export function createCommandRunner(deps: CommandRunnerDeps = browserDeps): CommandRunner {
  const isOnline = deps.isOnline ?? defaultIsOnline;
  const schedule = deps.schedule ?? defaultSchedule;
  const sleep = deps.sleep ?? defaultSleep;
  let id: string | null = null;
  let unresolved = false;
  let pending: Promise<Result<unknown>> | null = null;

  /**
   * One request. Settles once: with the call's result, with a failed Result when the call threw (the response was lost
   * or the request never completed), or with `TIMEOUT`. Whatever the call answers after that is ignored.
   */
  const once = <T>(call: (clientRequestId: string) => Promise<Result<T>>, sent: string): Promise<Result<T>> =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (r: Result<T>) => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(r);
      };
      const cancel = schedule(
        () => finish({ ok: false, error: appError("DEPENDENCY_FAILED", { reason: "TIMEOUT" }) }),
        COMMAND_TIMEOUT_MS,
      );
      try {
        call(sent).then(finish, () => finish({ ok: false, error: appError("DEPENDENCY_FAILED") }));
      } catch {
        finish({ ok: false, error: appError("DEPENDENCY_FAILED") });
      }
    });

  const attempt = async <T>(call: (clientRequestId: string) => Promise<Result<T>>): Promise<Result<T>> => {
    const sent = (id ??= deps.newId());
    const done = deps.registerBusy();
    try {
      // The id is kept after a lost response: the retry replays the first result or runs fresh.
      let result = await once(call, sent);
      if (!result.ok && result.error.code === "DEPENDENCY_FAILED") {
        await sleep(COMMAND_RETRY_DELAY_MS);
        result = await once(call, sent);
      }
      if (result.ok) {
        id = null;
        unresolved = false;
      } else {
        deps.onAppErrorCode(result.error.code);
        // The id belongs to another request: retrying it can never succeed, so the next submit is a new one.
        if (result.error.code === "IDEMPOTENCY_MISMATCH" && id === sent) {
          id = null;
          unresolved = false;
        } else if (isOutcomeUnknownCode(result.error.code)) {
          unresolved = true;
        } else {
          // A refusal that is known to have rolled back (validation, conflict, forbidden): nothing may be committed.
          unresolved = false;
        }
      }
      return result;
    } finally {
      done();
    }
  };

  return {
    run<T>(call: (clientRequestId: string) => Promise<Result<T>>): Promise<Result<T>> {
      if (pending) return pending as Promise<Result<T>>;
      // Offline: nothing is sent, no id is spent, nothing may have been committed.
      if (!isOnline()) return Promise.resolve({ ok: false, error: appError("DEPENDENCY_FAILED", { reason: "OFFLINE" }) });
      const p = attempt(call).finally(() => {
        pending = null;
      });
      pending = p;
      return p;
    },
    reset() {
      if (!pending && !unresolved) id = null;
    },
    settle() {
      unresolved = false;
    },
    startOver() {
      if (!pending) {
        id = null;
        unresolved = false;
      }
    },
    get unresolved() {
      return unresolved;
    },
    currentId: () => id,
    get inFlight() {
      return pending !== null;
    },
  };
}

export interface UseCommand {
  run<T>(call: (clientRequestId: string) => Promise<Result<T>>): Promise<Result<T>>;
  /**
   * Runs the last call again with the same id (the "Retry" of `SaveStatus`). A failed Result with `INTERNAL` when no
   * call has been made yet.
   */
  retry(): Promise<Result<unknown>>;
  reset(): void;
  /** See {@link CommandRunner.settle}: the form reloaded the state after an unknown outcome. */
  settle(): void;
  /** See {@link CommandRunner.startOver}: the user explicitly abandons the submit (the form clears its error too). */
  startOver(): void;
  /** True after a failure whose outcome is unknown, until `settle()`, `startOver()` or a success (see {@link CommandRunner}). */
  unresolved: boolean;
  /** True while a call is in flight, retry included (disable the submit button). */
  pending: boolean;
  /** The last failure of the current submit, cleared by the next attempt, a success or `reset()`. */
  error: AppError | null;
  /** For `<SaveStatus>` (`lib/commands/save-state.ts`). */
  saveState: SaveState;
  /** Clinic wall-clock `HH:mm` of the last success. */
  savedAt: string | null;
}

/** One command runner per component instance. */
export function useCommand(): UseCommand {
  const runner = useRef<CommandRunner | null>(null);
  runner.current ??= createCommandRunner();
  const mounted = useRef(true);
  const lastCall = useRef<((clientRequestId: string) => Promise<Result<unknown>>) | null>(null);
  const timeZone = useClinicTimeZone();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [last, setLast] = useState<Result<unknown> | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async <T>(call: (clientRequestId: string) => Promise<Result<T>>): Promise<Result<T>> => {
      const r = runner.current as CommandRunner;
      lastCall.current = call;
      setPending(true);
      setError(null);
      try {
        const result = await r.run(call);
        if (mounted.current) {
          setError(result.ok ? null : result.error);
          setUnresolved(r.unresolved);
          setLast(result);
          if (result.ok) {
            const { hour, minute } = clockOf(new Date(), timeZone);
            setSavedAt(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
          }
        }
        return result;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [timeZone],
  );

  const retry = useCallback((): Promise<Result<unknown>> => {
    const call = lastCall.current;
    if (!call) return Promise.resolve({ ok: false, error: appError("INTERNAL") });
    return run(call);
  }, [run]);

  // An edit after an unknown outcome keeps the id (and the error text: the user still has to find out what happened).
  const reset = useCallback(() => {
    const r = runner.current;
    r?.reset();
    if (!r?.unresolved) {
      setError(null);
      setLast((prev) => (prev && !prev.ok ? null : prev));
    }
  }, []);

  const settle = useCallback(() => {
    runner.current?.settle();
    setUnresolved(false);
  }, []);

  const startOver = useCallback(() => {
    runner.current?.startOver();
    setUnresolved(runner.current?.unresolved ?? false);
    setError(null);
    setLast((prev) => (prev && !prev.ok ? null : prev));
  }, []);

  const saveState = saveStateOf({ pending, last });

  return { run, retry, reset, settle, startOver, unresolved, pending, error, saveState, savedAt };
}
