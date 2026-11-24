import { emptyVersions, LIVE_DOMAINS, type LiveDomain, type LiveSnapshot, type Versions } from "./domains";

/**
 * Live convergence, the rules (V2-09e 09E-04, R-18): pure, with every dependency injected (the `createTodayLive` pattern of 08-03a), so
 * `tests/live/live-core.spec.ts` runs it with a fake clock and no browser.
 *
 * What a device knows: `seen`, the highest version it has learned for each domain, from any source (a Realtime signal, `GET /api/live/state`).
 * What a query knows: its basis, the `seen` it had when its fetch STARTED (a lower bound of what the data holds: at most one extra re-read, never
 * a missed one, research 2.1), or the versions the page read before it read the data (hydration). A version above a query's basis in one of its
 * domains means the data may be older than the database:
 *   - an ACTIVE query (a screen shows it) is re-read, coalesced {@link COALESCE_MS};
 *   - an INACTIVE one is removed, so it is never shown once behind.
 * A fetch that ends while `seen` moved past its basis is re-read again (a signal during a read is never lost).
 *
 * When it asks the server (`readState`): every {@link HEARTBEAT_MS} while a live screen is registered and the tab is visible (also while the
 * channel is SUBSCRIBED: a signal Realtime refused or dropped is caught within one beat), at once when the channel is (re)subscribed (when a live
 * screen or an active query with domains exists), when the tab becomes visible, on `online` and on resume. Never while the tab is hidden.
 *
 * What the badge says: "live" while the channel is SUBSCRIBED and a signal or a check confirmed the versions within {@link LIVE_FRESH_MS};
 * otherwise "reconnecting" with the seconds since the last confirmation.
 */
export const HEARTBEAT_MS = 12_000;
export const COALESCE_MS = 400;
export const LIVE_FRESH_MS = 24_000;

export type LiveMetric = "live_reread" | "live_dropped" | "live_reconnect";

/** A query that depends on some domains (the data layer's `meta.domains`). `id` is stable for the query's life. */
export interface Dependent {
  id: string;
  domains: readonly LiveDomain[];
  /** A screen is showing it now. */
  active: boolean;
}

export interface LiveCoreDeps {
  now: () => number;
  isVisible: () => boolean;
  /** Runs `fn` once after `ms`; returns the cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** Runs `fn` every `ms`; returns the cancel function. */
  every: (fn: () => void, ms: number) => () => void;
  /** One `GET /api/live/state`; null when it failed or was refused (the badge then ages, nothing else happens). */
  readState: () => Promise<LiveSnapshot | null>;
  dependents: () => readonly Dependent[];
  reread: (id: string) => void;
  remove: (id: string) => void;
  /** The clinic's access level from a confirmed read, every time (`full` is the normal answer). */
  onAccess: (access: string) => void;
  /** The badge may have changed (call `badge()` again). */
  onChange: () => void;
  record: (metric: LiveMetric, value: number) => void;
}

export type LiveBadge = { live: true } | { live: false; secondsAgo: number | null };

export interface LiveCore {
  /** A live screen (Today, Schedule) is open; returns the unregister function. The heartbeat runs while at least one is. */
  registerScreen(): () => void;
  /** The Realtime channel's own state (SUBSCRIBED or not). */
  channel(subscribed: boolean): void;
  /** A signal arrived on the channel. */
  signal(domain: LiveDomain, version: number): void;
  /** A signal of a shape this build does not know: the safe answer is to ask. */
  unknownSignal(): void;
  /** The tab became visible or hidden (read `isVisible`). */
  visibilityChanged(): void;
  /** `online` or resume: ask now. */
  wake(): void;
  /** A fetch of a dependent started / ended (the data layer's cache events). */
  fetchStarted(id: string): void;
  /** `ok` false: the read failed; the query keeps its old basis (its data is as old as before) and is tried again on the next confirmed check. */
  fetchEnded(id: string, ok: boolean): void;
  /** The query left the cache. */
  forget(id: string): void;
  /** The versions the page read before the data it handed over (hydration); only used while the query has no basis yet. */
  setBasis(id: string, versions: Versions): void;
  /** The basis of a query, for tests and the changed-elsewhere flag. */
  basisOf(id: string): Versions | undefined;
  seenVersions(): Versions;
  /** At least one signal or check has confirmed the versions since the core started. */
  hasConfirmed(): boolean;
  badge(): LiveBadge;
  stop(): void;
}

export function createLiveCore(deps: LiveCoreDeps): LiveCore {
  const seen = emptyVersions();
  /** The basis of what each query holds (committed when a fetch succeeds, or handed over by the page). */
  const basis = new Map<string, Versions>();
  /** `seen` at the start of each running fetch: it becomes the basis only if the fetch succeeds (a failed read leaves the old data). */
  const started = new Map<string, Versions>();
  const learnedAt = new Map<string, number>();
  let screens = 0;
  let subscribed = false;
  let everSubscribed = false;
  let lastConfirmed: number | null = null;
  let stopped = false;
  let beat: (() => void) | null = null;
  let coalesce: (() => void) | null = null;
  let inFlight = false;

  const staleDomains = (d: Dependent): boolean => {
    const b = basis.get(d.id);
    return d.domains.some((domain) => seen[domain] > (b?.[domain] ?? 0));
  };

  const confirm = () => {
    lastConfirmed = deps.now();
    deps.onChange();
  };

  const syncHeartbeat = () => {
    const wanted = !stopped && screens > 0 && deps.isVisible();
    if (wanted && !beat) beat = deps.every(() => void check(), HEARTBEAT_MS);
    if (!wanted && beat) {
      beat();
      beat = null;
    }
  };

  /** Re-reads the active stale dependents now; removes the inactive stale ones. */
  const flush = () => {
    coalesce = null;
    if (stopped) return;
    for (const d of deps.dependents()) {
      if (!staleDomains(d) || !d.active) continue;
      deps.reread(d.id);
    }
  };

  const evaluate = () => {
    if (stopped) return;
    let anyActive = false;
    for (const d of deps.dependents()) {
      if (!staleDomains(d)) continue;
      if (d.active) {
        anyActive = true;
        if (!learnedAt.has(d.id)) learnedAt.set(d.id, deps.now());
      } else {
        basis.delete(d.id);
        started.delete(d.id);
        learnedAt.delete(d.id);
        deps.remove(d.id);
      }
    }
    if (anyActive && !coalesce) coalesce = deps.schedule(flush, COALESCE_MS);
  };

  /** Folds versions into `seen`; returns whether any moved. */
  const learn = (versions: Partial<Versions>): boolean => {
    let moved = false;
    for (const domain of LIVE_DOMAINS) {
      const v = versions[domain];
      if (v !== undefined && v > seen[domain]) {
        seen[domain] = v;
        moved = true;
      }
    }
    return moved;
  };

  async function check(): Promise<void> {
    if (stopped) return;
    // One state call at a time: a trigger that arrives while one is out is answered by it (a signal carries its own version).
    if (inFlight) return;
    inFlight = true;
    let snapshot: LiveSnapshot | null = null;
    try {
      snapshot = await deps.readState();
    } catch {
      snapshot = null;
    }
    inFlight = false;
    if (stopped) return;
    if (snapshot) {
      // A version the channel should have told us about, found by the check while SUBSCRIBED: a dropped signal.
      const moved = learn(snapshot.versions);
      if (moved && subscribed) deps.record("live_dropped", 1);
      confirm();
      deps.onAccess(snapshot.access);
      // Also when nothing moved: a query whose last re-read failed is still behind and is tried again on every confirmed beat.
      evaluate();
    }
  }

  return {
    registerScreen() {
      screens += 1;
      syncHeartbeat();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        screens -= 1;
        syncHeartbeat();
      };
    },
    channel(isSubscribed) {
      if (stopped) return;
      const was = subscribed;
      subscribed = isSubscribed;
      deps.onChange();
      if (isSubscribed && !was) {
        if (everSubscribed) deps.record("live_reconnect", 1);
        everSubscribed = true;
        // The check closes the gap between what a screen read and the moment the channel started listening. With no live screen and no query that
        // depends on a domain there is nothing to catch up (the first one to appear carries its own basis), so a page of another kind pays no call.
        if (screens > 0 || deps.dependents().some((d) => d.active)) void check();
      }
    },
    signal(domain, version) {
      if (stopped) return;
      learn({ [domain]: version });
      confirm();
      evaluate();
    },
    unknownSignal() {
      void check();
    },
    visibilityChanged() {
      if (stopped) return;
      syncHeartbeat();
      if (deps.isVisible()) void check();
    },
    wake() {
      if (!stopped && deps.isVisible()) void check();
    },
    fetchStarted(id) {
      started.set(id, { ...seen });
    },
    fetchEnded(id, ok) {
      const from = started.get(id);
      started.delete(id);
      if (!ok || !from) return;
      basis.set(id, from);
      const at = learnedAt.get(id);
      if (at !== undefined) {
        learnedAt.delete(id);
        deps.record("live_reread", Math.max(0, deps.now() - at));
      }
      // The data this fetch returned is as old as its basis: when `seen` moved during the read, read again.
      evaluate();
    },
    forget(id) {
      basis.delete(id);
      started.delete(id);
      learnedAt.delete(id);
    },
    setBasis(id, versions) {
      if (!basis.has(id)) basis.set(id, { ...versions });
    },
    basisOf: (id) => basis.get(id),
    seenVersions: () => ({ ...seen }),
    hasConfirmed: () => lastConfirmed !== null,
    badge() {
      const age = lastConfirmed === null ? null : deps.now() - lastConfirmed;
      if (subscribed && age !== null && age <= LIVE_FRESH_MS) return { live: true };
      return { live: false, secondsAgo: age === null ? null : Math.floor(age / 1000) };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      beat?.();
      beat = null;
      coalesce?.();
      coalesce = null;
    },
  };
}
