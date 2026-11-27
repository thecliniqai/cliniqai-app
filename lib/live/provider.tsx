"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQueryClient, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { onAccessLevel } from "@/lib/pwa/lock";
import { registerCleanup } from "@/lib/pwa/cleanup";
import { rum } from "@/lib/observability/rum/collector";
import { LIVE_DOMAINS, parseSignal, parseSnapshot, type LiveDomain, type Versions } from "./domains";
import { clinicHeaders, isClinicChanged, onClinicChanged } from "./clinic-changed";
import { createLiveCore, type Dependent, type LiveCore, type LiveCoreDeps } from "./live-core";

/**
 * The tab's live convergence (V2-09e 09E-04, R-18), inside the dashboard shell and the query provider. It owns the one Realtime channel of the
 * clinic (`today:<tenant>`, signals `{domain, version}` only), opened while the tab is visible and closed 60 s after it is hidden (the Supabase
 * client is a separate chunk loaded after the first paint), the `online` hook, the badge's 5 s tick and the bridge between {@link createLiveCore}'s
 * rules and TanStack Query: the dependents are the queries whose `meta.domains` is set, a re-read is an `invalidateQueries` of exactly that query
 * (`cancelRefetch: false`: a read already in flight answers it, and the core asks again when it ends if a newer version arrived meanwhile), a removal
 * is `removeQueries`. Sign-out, the lock and the clinic switch stop it (the cleanup registry).
 */
export const CHANNEL_CLOSE_AFTER_HIDDEN_MS = 60_000;
export const BADGE_TICK_MS = 5_000;
export const STATE_URL = "/api/live/state";
const STATE_TIMEOUT_MS = 10_000;

interface LiveStore {
  core: LiveCore;
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
  /** A primitive that changes when the badge's words change (so `useSyncExternalStore` re-renders exactly then). */
  badgeKey: () => string;
  /** The versions seen, once confirmed (`""` before): changes when a domain moves. */
  versionsKey: () => string;
}

const LiveContext = createContext<LiveStore | null>(null);

function isLiveQuery(q: Query): boolean {
  return (q.meta?.domains?.length ?? 0) > 0;
}

/**
 * The versions an answer carries from the statement that read it (`versions` of a range, the bootstrap, the board), or that a command's transaction
 * produced (`versions` of its answer, 000134), when it has them.
 */
export function carriedVersions(data: unknown): Partial<Versions> | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const versions = (data as { versions?: unknown }).versions;
  if (versions === null || typeof versions !== "object") return undefined;
  const out: Partial<Versions> = {};
  for (const [domain, value] of Object.entries(versions as Record<string, unknown>)) {
    if ((LIVE_DOMAINS as readonly string[]).includes(domain) && typeof value === "number") out[domain as LiveDomain] = value;
  }
  return out;
}

function dependentsOf(client: QueryClient): Dependent[] {
  return client
    .getQueryCache()
    .findAll()
    .filter(isLiveQuery)
    .map((q) => ({ id: q.queryHash, domains: (q.meta?.domains ?? []) as readonly LiveDomain[], active: q.isActive(), passive: q.meta?.passive === true }));
}

async function readState(tenantId: string): Promise<ReturnType<typeof parseSnapshot>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATE_TIMEOUT_MS);
  try {
    const response = await fetch(STATE_URL, { cache: "no-store", credentials: "same-origin", signal: controller.signal, headers: clinicHeaders(tenantId) });
    if (await isClinicChanged(response)) {
      onClinicChanged();
      return null;
    }
    if (!response.ok) return null;
    return parseSnapshot(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function badgeKey(core: LiveCore): string {
  const badge = core.badge();
  if (badge.live) return "live";
  // Seconds in steps of 5 (the tick), so the words change when the tick does.
  return badge.secondsAgo === null ? "reconnecting" : `reconnecting:${Math.floor(badge.secondsAgo / 5) * 5}`;
}

function createStore(queryClient: QueryClient, tenantId: string): LiveStore {
  const listeners = new Set<() => void>();
  const deps: LiveCoreDeps = {
    now: () => Date.now(),
    isVisible: () => typeof document !== "undefined" && document.visibilityState === "visible",
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
    every: (fn, ms) => {
      const t = setInterval(fn, ms);
      return () => clearInterval(t);
    },
    readState: () => readState(tenantId),
    dependents: () => dependentsOf(queryClient),
    reread: (id) => void queryClient.invalidateQueries({ predicate: (q) => q.queryHash === id }, { cancelRefetch: false }),
    remove: (id) => queryClient.removeQueries({ predicate: (q) => q.queryHash === id }),
    onAccess: (access) => onAccessLevel(access),
    onChange: () => listeners.forEach((l) => l()),
    record: (metric, value) => rum.record(metric, value),
  };
  const core = createLiveCore(deps);
  return {
    core,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: () => listeners.forEach((l) => l()),
    badgeKey: () => badgeKey(core),
    versionsKey: () => (core.hasConfirmed() ? JSON.stringify(core.seenVersions()) : ""),
  };
}

export function LiveProvider({ tenantId, children }: { tenantId: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  // Created in the first render so a screen's effect (which runs before this component's) can register at once; nothing runs until then.
  const [store] = useState(() => createStore(queryClient, tenantId));
  const { core } = store;

  useEffect(() => {
    // The data layer's own events feed the basis rule: a fetch's start and end, a query leaving the cache.
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (!isLiveQuery(event.query)) return;
      const id = event.query.queryHash;
      if (event.type === "removed") core.forget(id);
      else if (event.type === "updated") {
        const action = event.action.type;
        if (action === "fetch") core.fetchStarted(id);
        // 09E-14a (L2): a `setQueryData` (a save's answer written into the board) is a success action too, but no read ended: only a fetch's own success commits a basis.
        else if (action === "success") {
          if (!(event.action as { manual?: boolean }).manual) core.fetchEnded(id, true, carriedVersions(event.query.state.data));
        }
        else if (action === "error") core.fetchEnded(id, false);
      }
    });

    let closeChannel: (() => void) | null = null;
    let refreshAuth: (() => void) | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const openChannel = () => {
      if (closeChannel) return;
      let closed = false;
      let removeChannel: (() => void) | null = null;
      void import("@/lib/supabase/client").then(async ({ realtimeClient }) => {
        if (closed) return;
        const client = realtimeClient();
        // PR 2 review N1: the user's token before the join. realtime-js applies the `accessToken` callback asynchronously, and a `subscribe` made before it
        // resolved joined with the publishable key: the private channel refused it and realtime-js rejoined about 6 s later (signals of that window lost).
        // realtime-js reads the callback again on every heartbeat (25 s) and pushes a changed token to the joined channel, so a refreshed session cookie
        // reaches the channel without a rejoin; `refreshAuth` below also does it at once when the tab is visible again or back online.
        try {
          await client.realtime.setAuth();
        } catch {
          // No token (signed out mid-load): the join is refused and the core's checks keep the screen current, as before.
        }
        if (closed) return;
        refreshAuth = () => void client.realtime.setAuth().catch(() => undefined);
        const channel = client.channel(`today:${tenantId}`, { config: { private: true } });
        channel.on("broadcast", { event: "today" }, (message) => {
          const signal = parseSignal(message.payload);
          if (signal) core.signal(signal.domain, signal.version);
          else core.unknownSignal();
        });
        channel.subscribe((status) => core.channel(status === "SUBSCRIBED"));
        removeChannel = () => void client.removeChannel(channel);
      });
      closeChannel = () => {
        closed = true;
        removeChannel?.();
        closeChannel = null;
        core.channel(false);
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = null;
        openChannel();
        refreshAuth?.();
      } else if (!closeTimer) {
        closeTimer = setTimeout(() => {
          closeTimer = null;
          closeChannel?.();
        }, CHANNEL_CLOSE_AFTER_HIDDEN_MS);
      }
      core.visibilityChanged();
    };
    const onOnline = () => {
      refreshAuth?.();
      core.wake();
    };

    if (document.visibilityState === "visible") openChannel();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const tick = setInterval(() => store.notify(), BADGE_TICK_MS);
    const unregister = registerCleanup(() => {
      core.stop();
      closeChannel?.();
    });

    return () => {
      unsubscribeCache();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      clearInterval(tick);
      if (closeTimer) clearTimeout(closeTimer);
      unregister();
      core.stop();
      closeChannel?.();
    };
  }, [core, queryClient, store, tenantId]);

  return <LiveContext.Provider value={store}>{children}</LiveContext.Provider>;
}

/**
 * 09E PR 2 (PO option A): after an own save whose answer was written into the queries `queryKeys` (`setQueryData`), hands the versions the command
 * produced (the answer's `versions`) to the live core, so this device's own signal re-reads nothing while another device's newer write still does
 * ({@link LiveCore.ownWrite}). Outside the provider, or with no versions in the answer, it does nothing (the signal then re-reads, as before).
 */
export function useOwnWrite(): (answer: unknown, queryKeys: readonly QueryKey[]) => void {
  const store = useContext(LiveContext);
  const queryClient = useQueryClient();
  return useCallback(
    (answer: unknown, queryKeys: readonly QueryKey[]) => {
      const versions = carriedVersions(answer);
      if (!store || !versions || Object.keys(versions).length === 0) return;
      const cache = queryClient.getQueryCache();
      const ids = queryKeys.flatMap((queryKey) => cache.findAll({ queryKey, exact: true }).map((q) => q.queryHash));
      store.core.ownWrite(versions, ids);
    },
    [store, queryClient],
  );
}

/** The live core of the shell; null outside the dashboard (a test, the locked pages). */
export function useLiveCore(): LiveCore | null {
  return useContext(LiveContext)?.core ?? null;
}

export type BadgeView = { live: true } | { live: false; secondsAgo: number | null };

/** What the badge says: re-renders when its words change (a confirmation, a drop, the 5 s tick). Outside the provider: reconnecting, never confirmed. */
export function useLiveBadge(): BadgeView {
  const store = useContext(LiveContext);
  const key = useSyncExternalStore(
    store?.subscribe ?? (() => () => undefined),
    store?.badgeKey ?? (() => "reconnecting"),
    () => "reconnecting",
  );
  return useMemo<BadgeView>(() => {
    if (key === "live") return { live: true };
    const [, seconds] = key.split(":");
    return { live: false, secondsAgo: seconds === undefined ? null : Number(seconds) };
  }, [key]);
}

/** The versions this device has seen (once a signal or check confirmed them), for the changed-elsewhere notice; null before. */
export function useSeenVersions(): Versions | null {
  const store = useContext(LiveContext);
  const key = useSyncExternalStore(
    store?.subscribe ?? (() => () => undefined),
    store?.versionsKey ?? (() => ""),
    () => "",
  );
  return useMemo(() => (key === "" ? null : (JSON.parse(key) as Versions)), [key]);
}
