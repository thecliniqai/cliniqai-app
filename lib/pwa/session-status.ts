import { ACCESS_DESTINATIONS, type AccessDestination } from "@/lib/auth/access-redirect";
import type { TenantAccessLevel } from "@/lib/auth/tenant";

/**
 * The client side of `GET /api/session-status` (V2-06 06-06; PWA_STRATEGY §3.7 step 2, §6.6; R-16, R-21). Browser-only
 * at run time; every dependency is injected so `tests/pwa/session-status.spec.ts` runs it in Node.
 *
 * When it checks ({@link startSessionStatusWatch}): once on start, on `visibilitychange` → visible, on `online`, every
 * {@link STATUS_INTERVAL_MS} while the page is visible, and when any part of the app reports an error
 * ({@link requestSessionCheck}: the route error boundary, the global `unhandledrejection` handler, a result carrying
 * `SUBSCRIPTION_LOCKED`), since any error may be a lock or a revoked session. One request at a time; error-triggered
 * checks at most once per {@link ERROR_CHECK_MIN_GAP_MS}.
 *
 * What it does with the answer ({@link reactToStatus}):
 * - 401 → `expired` (`hardSignOut("expired")`); 403 → `removed` (`hardSignOut("removed")`). After either, checking stops.
 * - 200 with a `redirect` → `locked(redirect)` (D-8: cleanups, then `location.replace`; the session is kept). Only one
 *   of 05-10b's three destinations is ever followed, never another URL from the answer.
 * - 200 with a `deploymentId` that differs from the page's ({@link currentPageDeploymentId}) → `updateAvailable` (a
 *   page without one, e.g. `next dev`, never reports an update: no loop).
 * - Anything else (offline, 409 clinic selection, 5xx, a redirect, an unreadable body) → nothing; the next trigger
 *   checks again. A transient failure never signs anyone out.
 */
export const SESSION_STATUS_URL = "/api/session-status";
export const STATUS_INTERVAL_MS = 5 * 60_000;
export const ERROR_CHECK_MIN_GAP_MS = 10_000;
export const STATUS_TIMEOUT_MS = 10_000;

const ACCESS_LEVELS: readonly TenantAccessLevel[] = ["full", "locked", "onboarding", "none"];
const DEPLOYMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface SessionStatus {
  deploymentId: string | null;
  accessLevel: TenantAccessLevel;
  redirect: AccessDestination | null;
}

export type StatusOutcome =
  | { kind: "ok"; status: SessionStatus }
  | { kind: "expired" }
  | { kind: "removed" }
  | { kind: "unknown" };

/** The 200 body, or null when it is not exactly `{ deploymentId, accessLevel, redirect }` with valid values. */
export function parseSessionStatus(body: unknown): SessionStatus | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "accessLevel,deploymentId,redirect") return null;
  const { deploymentId, accessLevel, redirect } = record;
  if (deploymentId !== null && (typeof deploymentId !== "string" || !DEPLOYMENT_ID.test(deploymentId))) return null;
  if (typeof accessLevel !== "string" || !(ACCESS_LEVELS as readonly string[]).includes(accessLevel)) return null;
  if (redirect !== null && (typeof redirect !== "string" || !(ACCESS_DESTINATIONS as readonly string[]).includes(redirect))) {
    return null;
  }
  // A non-full clinic always has a destination, a full one never: anything else is not an answer of this server.
  if ((accessLevel === "full") !== (redirect === null)) return null;
  return { deploymentId, accessLevel: accessLevel as TenantAccessLevel, redirect: redirect as AccessDestination | null };
}

/** One request to the status route. Never throws; a network error, a timeout or an odd answer is `unknown`. */
export async function readSessionStatus(fetchImpl: typeof fetch, timeoutMs: number = STATUS_TIMEOUT_MS): Promise<StatusOutcome> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      fetchImpl(SESSION_STATUS_URL, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        headers: { accept: "application/json" },
        signal: controller?.signal,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (answer === null) {
      controller?.abort();
      return { kind: "unknown" };
    }
    if (answer.status === 401) return { kind: "expired" };
    if (answer.status === 403) return { kind: "removed" };
    if (answer.status !== 200) return { kind: "unknown" };
    const status = parseSessionStatus(await answer.json());
    return status ? { kind: "ok", status } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The deployment id this page was served by. Next writes it as `data-dpl-id` on `<html>` in the server HTML, then its
 * client runtime reads the attribute, REMOVES it (before hydration) and keeps the value as
 * `globalThis.NEXT_DEPLOYMENT_ID` (`next/dist/shared/lib/deployment-id.js`, `client/register-deployment-id-global.js`).
 * So the global first, the attribute only as a fallback; null without a deployment id (local `next dev`).
 */
export function currentPageDeploymentId(
  global: { NEXT_DEPLOYMENT_ID?: unknown } = globalThis as { NEXT_DEPLOYMENT_ID?: unknown },
  doc: { documentElement: { dataset: { dplId?: string } } } | undefined = typeof document === "undefined" ? undefined : document,
): string | null {
  const fromGlobal = global.NEXT_DEPLOYMENT_ID;
  if (typeof fromGlobal === "string" && DEPLOYMENT_ID.test(fromGlobal)) return fromGlobal;
  const fromAttribute = doc?.documentElement.dataset.dplId;
  return fromAttribute && DEPLOYMENT_ID.test(fromAttribute) ? fromAttribute : null;
}

/** True only when both ids are known and differ (a page without a deployment id never asks for an update). */
export function isDeploymentMismatch(serverId: string | null, pageId: string | null | undefined): boolean {
  return Boolean(serverId) && Boolean(pageId) && serverId !== pageId;
}

export interface StatusReactions {
  expired: () => void;
  removed: () => void;
  locked: (destination: AccessDestination) => void;
  updateAvailable: () => void;
}

export type Reaction = "expired" | "removed" | "locked" | "update" | "none";

/** Applies one outcome; returns what it did. `expired`, `removed` and `locked` end the watch (the page is leaving). */
export function reactToStatus(outcome: StatusOutcome, pageDeploymentId: string | null | undefined, on: StatusReactions): Reaction {
  if (outcome.kind === "expired") {
    on.expired();
    return "expired";
  }
  if (outcome.kind === "removed") {
    on.removed();
    return "removed";
  }
  if (outcome.kind !== "ok") return "none";
  if (outcome.status.redirect) {
    on.locked(outcome.status.redirect);
    return "locked";
  }
  if (isDeploymentMismatch(outcome.status.deploymentId, pageDeploymentId)) {
    on.updateAvailable();
    return "update";
  }
  return "none";
}

// ---------------------------------------------------------------------------------------------------------------------
// App-wide check requests (the error boundary, the unhandledrejection handler, lock.ts)
// ---------------------------------------------------------------------------------------------------------------------

export type CheckTrigger = "start" | "visible" | "online" | "interval" | "error" | "lock" | "manual";
const requestListeners = new Set<(trigger: CheckTrigger) => Promise<Reaction | "skipped">>();

/** Asks the running watch (if any) to check now. Safe to call from anywhere, any number of times. */
export function requestSessionCheck(trigger: Extract<CheckTrigger, "error" | "lock" | "manual"> = "error"): void {
  for (const listener of [...requestListeners]) void listener(trigger);
}

/**
 * V2-06 06-04b ("Check for updates" in the More sheet): checks now and resolves with the reaction (`"update"` when
 * another deployment answered), or `"skipped"` when no watch runs. Not throttled; a running check is joined.
 */
export async function checkSessionNow(): Promise<Reaction | "skipped"> {
  const [listener] = [...requestListeners];
  return listener ? listener("manual") : "skipped";
}

export interface WatchDeps {
  fetch: typeof fetch;
  /** The page's deployment id ({@link currentPageDeploymentId}), read at each answer. */
  pageDeploymentId: () => string | null | undefined;
  isVisible: () => boolean;
  /** Subscribes to `visibilitychange` and `online`; returns the unsubscribe. */
  listen: (onVisible: () => void, onOnline: () => void) => () => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
  reactions: StatusReactions;
}

export interface SessionStatusWatch {
  /** Checks now (subject to the single-flight rule and, for `error`/`lock`, the minimum gap). Resolves when done. */
  check: (trigger: CheckTrigger) => Promise<Reaction | "skipped">;
  stop: () => void;
}

/** Starts the watch: one check now, then on every trigger until {@link SessionStatusWatch.stop} or a leaving reaction. */
export function startSessionStatusWatch(deps: WatchDeps): SessionStatusWatch {
  let stopped = false;
  let inFlight: Promise<Reaction | "skipped"> | null = null;
  let lastStart = Number.NEGATIVE_INFINITY;

  const check = (trigger: CheckTrigger): Promise<Reaction | "skipped"> => {
    if (stopped) return Promise.resolve("skipped");
    if (inFlight) return inFlight;
    if ((trigger === "error" || trigger === "lock") && deps.now() - lastStart < ERROR_CHECK_MIN_GAP_MS) {
      return Promise.resolve("skipped");
    }
    if (trigger === "interval" && !deps.isVisible()) return Promise.resolve("skipped");
    lastStart = deps.now();
    inFlight = (async () => {
      const outcome = await readSessionStatus(deps.fetch);
      if (stopped) return "skipped" as const;
      const reaction = reactToStatus(outcome, deps.pageDeploymentId(), deps.reactions);
      if (reaction === "expired" || reaction === "removed" || reaction === "locked") stop();
      return reaction;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const onRequest = (trigger: CheckTrigger) => check(trigger);
  requestListeners.add(onRequest);
  const unlisten = deps.listen(
    () => void check("visible"),
    () => void check("online"),
  );
  const interval = deps.setInterval(() => void check("interval"), STATUS_INTERVAL_MS);

  function stop() {
    if (stopped) return;
    stopped = true;
    requestListeners.delete(onRequest);
    unlisten();
    deps.clearInterval(interval);
  }

  void check("start");
  return { check, stop };
}
