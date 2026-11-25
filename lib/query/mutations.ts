"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AppError, Result } from "@/lib/errors/app-error";
import { useCommand, type UseCommand } from "@/lib/commands/use-command";
import { rum } from "@/lib/observability/rum/collector";
import type { RumMetric } from "@/lib/observability/rum/catalog";

/**
 * Saves by risk class (V2-09e 09E-08, R-11; ADR-004, PWA-06). Two hooks on TanStack Query's `useMutation`, both over the one command helper
 * (`useCommand`: one `client_request_id` per logical submit, a 15 s timeout, one retry with the same id, the dirty guard while in flight):
 *
 * - {@link useReversibleCommand}: the result is applied to the queries at once (`apply`), the command is sent, and a refusal or a failure takes the
 *   previous state back (the rollback `apply` returned) before `onFailure` shows the fixed error with its Retry. Used where undoing is cheap and
 *   nothing outside the screen depends on the answer (queue moves on Today, Rx lines, diagnoses, vitals, the draft).
 * - {@link useConfirmedCommand}: nothing changes on screen until the database has answered. The caller shows a pending state only (a button spinner,
 *   "Saving..."), `pending` here; the command's own result is applied with `setQueryData` (`onValue`), never an optimistic guess. Used for booking,
 *   payment, allergies, settings and sign and finish ("Saved" is never shown before the server confirmed).
 *
 * Both: one command per save, the result applied from the answer (no read-back), a retry reuses the request id, a mutation never retries on its own
 * (`createQueryClient`: `mutations.retry` 0), and the real-user timing (`save_reversible`, `save_confirmed`, `finish_confirmed`) carries no id, name or
 * text (the closed lists of `lib/observability/rum/catalog.ts`).
 */
export interface CommandMutationOptions<V, T> {
  /** The server action. It must send the id it is given. */
  call: (vars: V, clientRequestId: string) => Promise<Result<T>>;
  /**
   * Which submit this is: the same key after a failure keeps the request id (an idempotent retry; a lost response may hide a commit), another key
   * starts a new request. Default: every run is the same submit until it succeeded (a button that sends one fixed thing).
   */
  keyOf?: (vars: V) => string;
  /** The command's answer, applied to the queries. Runs on success only. */
  onValue?: (value: T, vars: V, queryClient: QueryClient) => void;
  /** Runs after a failure (and, for a reversible command, after the rollback): the fixed error with its Retry. `retry` sends the same save again. */
  onFailure?: (error: AppError, vars: V, retry: () => void) => void;
  /** The timing recorded on success. Default `save_reversible` / `save_confirmed`; sign and finish passes `finish_confirmed`. */
  metric?: Extract<RumMetric, "save_reversible" | "save_confirmed" | "finish_confirmed">;
}

export interface ReversibleOptions<V, T> extends CommandMutationOptions<V, T> {
  /** Applies the result to the queries at once and returns the function that takes it back. */
  apply: (vars: V, queryClient: QueryClient) => () => void;
}

export interface CommandMutation<V, T> {
  /** Sends the save. Resolves with the command's result; a failed one has already been rolled back (reversible) and reported (`onFailure`). */
  run: (vars: V) => Promise<Result<T>>;
  /** True from the call until the answer (the confirm class shows its pending state from this). */
  pending: boolean;
  /** The command helper (error, saveState, settle...). */
  command: UseCommand;
}

type Phase = "reversible" | "confirmed";
type Context = { rollback: (() => void) | null; stop: () => void };

function useCommandMutation<V, T>(phase: Phase, options: CommandMutationOptions<V, T> & { apply?: ReversibleOptions<V, T>["apply"] }): CommandMutation<V, T> {
  const queryClient = useQueryClient();
  const command = useCommand();
  // The options of the latest render: a callback made in an earlier one still reads current state.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const lastKey = useRef<string | null>(null);

  const mutation = useMutation<Result<T>, never, V, Context>({
    mutationFn: (vars) => {
      const o = latest.current;
      const key = o.keyOf ? o.keyOf(vars) : "";
      // Other inputs than the last failed send's are a new request; the same ones keep their id (an idempotent retry).
      if (lastKey.current !== key) command.reset();
      lastKey.current = key;
      return command.run((clientRequestId) => o.call(vars, clientRequestId));
    },
    onMutate: (vars) => {
      const o = latest.current;
      const metric = o.metric ?? (phase === "reversible" ? "save_reversible" : "save_confirmed");
      const stop = rum.timer(metric);
      if (phase === "reversible" && o.apply) {
        const rollback = o.apply(vars, queryClient);
        // The state is applied: the next frame is the first the person sees it in. The timing is the result shown, not the answer.
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => stop());
        else stop();
        return { rollback, stop: () => undefined };
      }
      return { rollback: null, stop };
    },
    onSuccess: (result, vars, context) => {
      const o = latest.current;
      if (result.ok) {
        // A confirmed save is timed to the database's answer.
        context?.stop();
        o.onValue?.(result.value, vars, queryClient);
        return;
      }
      // The previous state comes back first, then the fixed error with its Retry.
      context?.rollback?.();
      o.onFailure?.(result.error, vars, () => void run(vars));
    },
  });

  const { mutateAsync } = mutation;
  // 09E-14a (L1): a second submit while one is in flight gets the first one's answer (as `command.run` does) and starts no second mutation: `onMutate` (the
  // optimistic apply) and `onSuccess` (the answer's callbacks) run once per save, never twice.
  const inFlight = useRef<Promise<Result<T>> | null>(null);
  const run = useCallback(
    (vars: V): Promise<Result<T>> => {
      if (inFlight.current) return inFlight.current;
      const started = mutateAsync(vars).finally(() => {
        if (inFlight.current === started) inFlight.current = null;
      });
      inFlight.current = started;
      return started;
    },
    [mutateAsync],
  );
  return { run, pending: mutation.isPending, command };
}

export function useReversibleCommand<V, T>(options: ReversibleOptions<V, T>): CommandMutation<V, T> {
  return useCommandMutation<V, T>("reversible", options);
}

export function useConfirmedCommand<V, T>(options: CommandMutationOptions<V, T>): CommandMutation<V, T> {
  return useCommandMutation<V, T>("confirmed", options);
}

/**
 * The confirm class for a form that builds its own call (a sheet, a drawer): `run(call)` sends `call` through the command helper as a confirmed save
 * (`save_confirmed`, or the `metric` given), exposing the same `command` (error, `saveState`, `reset`, `retry`) the form's SaveStatus already reads. Nothing
 * changes on screen until the answer; the caller applies the answer (`useAfterSave`) and only then shows its success text.
 */
export function useConfirmedCall(options?: Pick<CommandMutationOptions<unknown, unknown>, "metric">): {
  run: <T>(call: (clientRequestId: string) => Promise<Result<T>>) => Promise<Result<T>>;
  pending: boolean;
  command: UseCommand;
} {
  const mutation = useConfirmedCommand<(clientRequestId: string) => Promise<Result<unknown>>, unknown>({
    call: (call, clientRequestId) => call(clientRequestId),
    metric: options?.metric,
  });
  const { run: send } = mutation;
  const run = useCallback(<T,>(call: (clientRequestId: string) => Promise<Result<T>>) => send(call as (clientRequestId: string) => Promise<Result<unknown>>) as Promise<Result<T>>, [send]);
  return { run, pending: mutation.pending, command: mutation.command };
}
