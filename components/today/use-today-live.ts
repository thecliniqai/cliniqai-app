"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { registerCleanup } from "@/lib/pwa/cleanup";
import { queryKeys } from "@/lib/query/keys";

/**
 * Today's live updates (V2-08 08-03a, R-10, TARGET §3.9, PWA §3.2). The server sends a signal-only private broadcast on
 * `today:<tenant>` (`{kind, visit_id}`, no PHI) when a visit, queue token, payment or vitals row changes; the board
 * never reads the signal, it re-reads through the normal RLS read: signals are coalesced for {@link SIGNAL_COALESCE_MS}
 * and answered by one refresh. While the channel is not SUBSCRIBED (the socket refused, the network down, a rejoin) the
 * board polls every {@link POLL_INTERVAL_MS} while the page is visible, so it is never stale for long; every
 * (re)subscription refreshes once to catch what was missed. Resume from the background is refreshed by the shell
 * (`/today` is a live view, `lib/pwa/resume.ts`). 09E-03 (R-14): a refresh invalidates Today's query, so the re-read is one
 * `GET /api/today/board` into the same key (no RSC request, no page render); a failed or offline read keeps the rows on screen.
 *
 * {@link createTodayLive} holds the rules and no React or browser (`tests/today/live.spec.ts`, fake clock);
 * {@link useTodayLive} binds it to a component.
 */
export const SIGNAL_COALESCE_MS = 400;
export const POLL_INTERVAL_MS = 20_000;

/** `connecting` until the channel answers once (polling already runs); then `live` (SUBSCRIBED) or `polling`. */
export type LiveState = "connecting" | "live" | "polling";

export interface TodayLiveDeps {
  /** Opens the channel; returns the close function. `onStatus(true)` = SUBSCRIBED. */
  subscribe: (handlers: { onSignal: () => void; onStatus: (subscribed: boolean) => void }) => () => void;
  /** One refresh of the board (already guarded: it may do nothing while offline). */
  refresh: () => void;
  isVisible: () => boolean;
  /** Runs `fn` once after `ms`; returns the cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** Runs `fn` every `ms`; returns the cancel function. */
  every: (fn: () => void, ms: number) => () => void;
  onState: (state: LiveState) => void;
}

export interface TodayLive {
  /** Call when the page becomes visible or hidden. */
  visibilityChanged(): void;
  stop(): void;
}

export function createTodayLive(deps: TodayLiveDeps): TodayLive {
  let subscribed = false;
  let stopped = false;
  let coalesce: (() => void) | null = null;
  let poll: (() => void) | null = null;

  const syncPolling = () => {
    const wanted = !stopped && !subscribed && deps.isVisible();
    if (wanted && !poll) poll = deps.every(() => deps.refresh(), POLL_INTERVAL_MS);
    if (!wanted && poll) {
      poll();
      poll = null;
    }
  };

  const close = deps.subscribe({
    onSignal: () => {
      if (stopped || coalesce) return;
      coalesce = deps.schedule(() => {
        coalesce = null;
        deps.refresh();
      }, SIGNAL_COALESCE_MS);
    },
    onStatus: (isSubscribed) => {
      if (stopped) return;
      const was = subscribed;
      subscribed = isSubscribed;
      deps.onState(isSubscribed ? "live" : "polling");
      // A (re)subscription refreshes once: a change may have happened while the channel was not listening.
      if (isSubscribed && !was) deps.refresh();
      syncPolling();
    },
  });

  // Until the channel says SUBSCRIBED the board polls: a socket that never opens must not leave it stale.
  syncPolling();

  return {
    visibilityChanged: syncPolling,
    stop() {
      if (stopped) return;
      stopped = true;
      coalesce?.();
      coalesce = null;
      poll?.();
      poll = null;
      close();
    },
  };
}

/** Starts the live updates of Today for `tenantId`; returns the state for `LiveStatus` and a manual refresh. */
export function useTodayLive(tenantId: string): { state: LiveState; refreshNow: () => void } {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    // `cancelRefetch: false`: a read already in flight answers this refresh too (a signal burst never aborts and restarts the read).
    refreshRef.current = () => void queryClient.invalidateQueries({ queryKey: queryKeys.todayAll(tenantId) }, { cancelRefetch: false });
  }, [queryClient, tenantId]);

  useEffect(() => {
    const live = createTodayLive({
      subscribe: ({ onSignal, onStatus }) => {
        // The Supabase client is a separate chunk, loaded after the board is on screen: it is not part of the route's first-load JS.
        let closed = false;
        let close: (() => void) | null = null;
        void import("@/lib/supabase/client").then(({ realtimeClient }) => {
          if (closed) return;
          const client = realtimeClient();
          const channel = client.channel(`today:${tenantId}`, { config: { private: true } });
          channel.on("broadcast", { event: "today" }, () => onSignal());
          channel.subscribe((status) => onStatus(status === "SUBSCRIBED"));
          close = () => void client.removeChannel(channel);
        });
        return () => {
          closed = true;
          close?.();
        };
      },
      refresh: () => refreshRef.current(),
      isVisible: () => document.visibilityState === "visible",
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      every: (fn, ms) => {
        const t = setInterval(fn, ms);
        return () => clearInterval(t);
      },
      onState: setState,
    });
    const onVisibility = () => live.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    // Sign-out and the lock redirect close the channel (lib/pwa/cleanup.ts).
    const unregister = registerCleanup(() => live.stop());
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unregister();
      live.stop();
    };
  }, [tenantId]);

  return { state, refreshNow: () => refreshRef.current() };
}
