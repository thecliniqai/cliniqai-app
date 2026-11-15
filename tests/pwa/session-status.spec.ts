/**
 * V2-06 06-06: the client side of the session-status poll (`lib/pwa/session-status.ts`), the lock reaction
 * (`lib/pwa/lock.ts`) and the skew guard (`lib/pwa/skew.ts`), in Node with injected browser calls. The browser proof
 * is tests/e2e/pwa/06-update.spec.ts (update, skew, lock) and 05-cache-audit.spec.ts (expired, removed).
 *
 * Each rule here has a case that fails without it:
 * - 401 → expired, 403 → removed; a 5xx, 409, redirect, timeout or network error → nothing (no sign-out on a blip);
 * - only 05-10b's three destinations are ever followed (an answer naming another URL is ignored);
 * - an update needs both ids, and different ones (a page without `data-dpl-id` never loops);
 * - one request at a time; error-triggered checks at most once per 10 s; the interval skips hidden pages; a leaving
 *   reaction stops the watch;
 * - a lock conceals, runs the "lock" cleanups, then replaces (session kept: no sign-out call);
 * - a skew error marks the skew notice and asks for a check; another error only asks for a check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import {
  currentPageDeploymentId,
  ERROR_CHECK_MIN_GAP_MS,
  isDeploymentMismatch,
  parseSessionStatus,
  reactToStatus,
  readSessionStatus,
  requestSessionCheck,
  SESSION_STATUS_URL,
  startSessionStatusWatch,
  STATUS_INTERVAL_MS,
  type StatusReactions,
  type WatchDeps,
} from "@/lib/pwa/session-status";
import { onAppErrorCode, onLocked, resetLockForTests } from "@/lib/pwa/lock";
import { noteAppError, startSkewGuard } from "@/lib/pwa/skew";
import { getUpdateState, resetUpdateStateForTests } from "@/lib/pwa/update";

/** Lets a resolved check finish (its `finally` clears the in-flight slot). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const FULL = { deploymentId: "dpl_a", accessLevel: "full", redirect: null };

function recorder(): StatusReactions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    expired: () => calls.push("expired"),
    removed: () => calls.push("removed"),
    locked: (d) => calls.push(`locked ${d}`),
    updateAvailable: () => calls.push("update"),
  };
}

describe("parseSessionStatus", () => {
  it("accepts exactly the three keys with valid values", () => {
    expect(parseSessionStatus(FULL)).toEqual(FULL);
    expect(parseSessionStatus({ deploymentId: null, accessLevel: "locked", redirect: "/billing/locked" })).toEqual({
      deploymentId: null,
      accessLevel: "locked",
      redirect: "/billing/locked",
    });
    expect(parseSessionStatus({ deploymentId: null, accessLevel: "onboarding", redirect: "/onboarding/billing" })).not.toBeNull();
    expect(parseSessionStatus({ deploymentId: null, accessLevel: "none", redirect: "/billing/locked/staff" })).not.toBeNull();
  });

  it("refuses any other destination, extra or missing keys, odd levels and inconsistent answers", () => {
    for (const redirect of ["https://evil.example/", "//evil.example", "/patients", "/billing/locked/../../patients", "javascript:alert(1)"]) {
      expect(parseSessionStatus({ deploymentId: null, accessLevel: "locked", redirect }), redirect).toBeNull();
    }
    expect(parseSessionStatus({ ...FULL, patientName: "x" })).toBeNull();
    expect(parseSessionStatus({ accessLevel: "full", redirect: null })).toBeNull();
    expect(parseSessionStatus({ ...FULL, accessLevel: "admin" })).toBeNull();
    expect(parseSessionStatus({ ...FULL, deploymentId: "bad id" })).toBeNull();
    expect(parseSessionStatus({ deploymentId: null, accessLevel: "full", redirect: "/billing/locked" })).toBeNull();
    expect(parseSessionStatus({ deploymentId: null, accessLevel: "locked", redirect: null })).toBeNull();
    expect(parseSessionStatus([FULL])).toBeNull();
    expect(parseSessionStatus(null)).toBeNull();
  });
});

describe("readSessionStatus", () => {
  it("calls the route same-origin, no-store, manual redirects", async () => {
    const fetchImpl = vi.fn(async () => json(200, FULL));
    await readSessionStatus(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      SESSION_STATUS_URL,
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "manual" }),
    );
  });

  it("401 → expired, 403 → removed, 200 → ok", async () => {
    expect(await readSessionStatus((async () => json(401, { error: "unauthenticated" })) as unknown as typeof fetch)).toEqual({ kind: "expired" });
    expect(await readSessionStatus((async () => json(403, { error: "no_membership" })) as unknown as typeof fetch)).toEqual({ kind: "removed" });
    expect(await readSessionStatus((async () => json(200, FULL)) as unknown as typeof fetch)).toEqual({ kind: "ok", status: FULL });
  });

  it("409, 5xx, an opaque redirect, a bad body, a network error or a timeout → unknown (never a sign-out)", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => json(409, { error: "clinic_selection_required" }),
      async () => json(503, { error: "unavailable" }),
      async () => json(500, {}),
      // An opaque redirect (redirect: "manual") or a network error both read as status 0.
      async () => Response.error(),
      async () => new Response("<html>login</html>", { status: 200 }),
      async () => json(200, { ...FULL, extra: 1 }),
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ];
    for (const fn of cases) expect(await readSessionStatus(fn as unknown as typeof fetch)).toEqual({ kind: "unknown" });
    const never = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    expect(await readSessionStatus(never, 20)).toEqual({ kind: "unknown" });
  });
});

describe("reactToStatus", () => {
  it("expired / removed / locked / update / none", () => {
    const r = recorder();
    expect(reactToStatus({ kind: "expired" }, "dpl_a", r)).toBe("expired");
    expect(reactToStatus({ kind: "removed" }, "dpl_a", r)).toBe("removed");
    expect(reactToStatus({ kind: "ok", status: { deploymentId: "dpl_a", accessLevel: "locked", redirect: "/billing/locked/staff" } }, "dpl_a", r)).toBe("locked");
    expect(reactToStatus({ kind: "ok", status: { ...FULL, deploymentId: "dpl_b" } as never }, "dpl_a", r)).toBe("update");
    expect(reactToStatus({ kind: "ok", status: FULL as never }, "dpl_a", r)).toBe("none");
    expect(reactToStatus({ kind: "unknown" }, "dpl_a", r)).toBe("none");
    expect(r.calls).toEqual(["expired", "removed", "locked /billing/locked/staff", "update"]);
  });

  it("a lock wins over an update (the page is leaving anyway)", () => {
    const r = recorder();
    reactToStatus({ kind: "ok", status: { deploymentId: "dpl_b", accessLevel: "locked", redirect: "/billing/locked" } }, "dpl_a", r);
    expect(r.calls).toEqual(["locked /billing/locked"]);
  });

  it("no update without both ids (a dev page has no data-dpl-id; a server without an id answers null)", () => {
    expect(isDeploymentMismatch("dpl_b", undefined)).toBe(false);
    expect(isDeploymentMismatch("dpl_b", null)).toBe(false);
    expect(isDeploymentMismatch(null, "dpl_a")).toBe(false);
    expect(isDeploymentMismatch("dpl_a", "dpl_a")).toBe(false);
    expect(isDeploymentMismatch("dpl_b", "dpl_a")).toBe(true);
  });
});

describe("currentPageDeploymentId", () => {
  it("reads Next's global first (Next removes data-dpl-id before hydration), the attribute as a fallback", () => {
    const doc = (dplId?: string) => ({ documentElement: { dataset: { dplId } } });
    expect(currentPageDeploymentId({ NEXT_DEPLOYMENT_ID: "e2e-local-deployment" }, doc(undefined))).toBe("e2e-local-deployment");
    expect(currentPageDeploymentId({}, doc("dpl_attr"))).toBe("dpl_attr");
    expect(currentPageDeploymentId({ NEXT_DEPLOYMENT_ID: "dpl_global" }, doc("dpl_attr"))).toBe("dpl_global");
    expect(currentPageDeploymentId({}, doc(undefined))).toBeNull();
    expect(currentPageDeploymentId({ NEXT_DEPLOYMENT_ID: false }, doc(""))).toBeNull();
    expect(currentPageDeploymentId({ NEXT_DEPLOYMENT_ID: "bad id" }, doc(undefined))).toBeNull();
  });
});

describe("startSessionStatusWatch", () => {
  let clock = 0;
  let visible = true;
  let onVisible: () => void = () => undefined;
  let onOnline: () => void = () => undefined;
  let tick: () => void = () => undefined;

  function deps(fetchImpl: typeof fetch, reactions: StatusReactions, page = "dpl_a"): WatchDeps {
    return {
      fetch: fetchImpl,
      pageDeploymentId: () => page,
      isVisible: () => visible,
      listen: (v, o) => {
        onVisible = v;
        onOnline = o;
        return () => {
          onVisible = () => undefined;
          onOnline = () => undefined;
        };
      },
      setInterval: (fn, ms) => {
        expect(ms).toBe(STATUS_INTERVAL_MS);
        tick = fn;
        return 1;
      },
      clearInterval: () => {
        tick = () => undefined;
      },
      now: () => clock,
      reactions,
    };
  }

  beforeEach(() => {
    clock = 1_000_000;
    visible = true;
  });

  it("checks on start, on visible, on online and on the interval while visible", async () => {
    const fetchImpl = vi.fn(async () => json(200, FULL));
    const watch = startSessionStatusWatch(deps(fetchImpl as unknown as typeof fetch, recorder()));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await settle();
    onVisible();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await settle();
    onOnline();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    await settle();
    tick();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
    await settle();
    visible = false;
    expect(await watch.check("interval")).toBe("skipped");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    watch.stop();
  });

  it("one request at a time: triggers during a pending check share it", async () => {
    let release: (r: Response) => void = () => undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const watch = startSessionStatusWatch(deps(fetchImpl as unknown as typeof fetch, recorder()));
    onVisible();
    onOnline();
    requestSessionCheck("error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release(json(200, FULL));
    watch.stop();
  });

  it("error-triggered checks run at most once per ERROR_CHECK_MIN_GAP_MS", async () => {
    const fetchImpl = vi.fn(async () => json(200, FULL));
    const watch = startSessionStatusWatch(deps(fetchImpl as unknown as typeof fetch, recorder()));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await settle();
    expect(await watch.check("error")).toBe("skipped");
    clock += ERROR_CHECK_MIN_GAP_MS;
    expect(await watch.check("error")).toBe("none");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it("requestSessionCheck reaches the running watch, and nothing after stop()", async () => {
    const fetchImpl = vi.fn(async () => json(200, FULL));
    const watch = startSessionStatusWatch(deps(fetchImpl as unknown as typeof fetch, recorder()));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await settle();
    clock += ERROR_CHECK_MIN_GAP_MS;
    requestSessionCheck("lock");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await settle();
    watch.stop();
    clock += ERROR_CHECK_MIN_GAP_MS;
    requestSessionCheck("error");
    onVisible();
    tick();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a leaving reaction (expired) stops the watch: no further checks", async () => {
    const r = recorder();
    const fetchImpl = vi.fn(async () => json(401, { error: "unauthenticated" }));
    startSessionStatusWatch(deps(fetchImpl as unknown as typeof fetch, r));
    await vi.waitFor(() => expect(r.calls).toEqual(["expired"]));
    onVisible();
    clock += ERROR_CHECK_MIN_GAP_MS;
    requestSessionCheck("error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a 503 changes nothing and the next trigger checks again", async () => {
    const r = recorder();
    const fetchImpl = vi.fn(async () => json(503, { error: "unavailable" }));
    const watch = startSessionStatusWatch(deps(fetchImpl as unknown as typeof fetch, r));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await settle();
    onVisible();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await settle();
    expect(r.calls).toEqual([]);
    watch.stop();
  });
});

describe("onLocked (D-8: the session is kept)", () => {
  afterEach(() => resetLockForTests());

  it("conceals, runs the lock cleanups, then replaces; never signs out", async () => {
    const order: string[] = [];
    await onLocked("/billing/locked", {
      conceal: () => order.push("conceal"),
      runCleanups: async () => {
        order.push("cleanups");
      },
      replace: (url) => order.push(`replace ${url}`),
    });
    expect(order).toEqual(["conceal", "cleanups", "replace /billing/locked"]);
  });

  it("replaces even when a cleanup rejects; a second call does nothing", async () => {
    const order: string[] = [];
    const deps = {
      conceal: () => order.push("conceal"),
      runCleanups: async () => {
        throw new Error("synthetic cleanup failure");
      },
      replace: (url: string) => order.push(`replace ${url}`),
    };
    await onLocked("/billing/locked/staff", deps);
    await onLocked("/billing/locked/staff", deps);
    expect(order).toEqual(["conceal", "replace /billing/locked/staff"]);
  });

  it("onAppErrorCode: SUBSCRIPTION_LOCKED → a status check; UNAUTHENTICATED → expired sign-out; others untouched", () => {
    const calls: string[] = [];
    const deps = { check: () => calls.push("check"), signOutExpired: () => calls.push("expired") };
    expect(onAppErrorCode("SUBSCRIPTION_LOCKED", deps)).toBe(true);
    expect(onAppErrorCode("UNAUTHENTICATED", deps)).toBe(true);
    expect(onAppErrorCode("VALIDATION_FAILED", deps)).toBe(false);
    expect(onAppErrorCode(undefined, deps)).toBe(false);
    expect(calls).toEqual(["check", "expired"]);
  });
});

describe("skew guard", () => {
  beforeEach(() => resetUpdateStateForTests());

  it("an unrecognised Server Action (Next's own error) is skew: the notice is set, a check is asked for", async () => {
    const fetchImpl = vi.fn(async () => json(200, FULL));
    const watch = startSessionStatusWatch({
      fetch: fetchImpl as unknown as typeof fetch,
      pageDeploymentId: () => "dpl_a",
      isVisible: () => true,
      listen: () => () => undefined,
      setInterval: () => 0,
      clearInterval: () => undefined,
      now: (() => {
        let t = 0;
        return () => (t += ERROR_CHECK_MIN_GAP_MS);
      })(),
      reactions: recorder(),
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await settle();
    expect(noteAppError(new UnrecognizedActionError("Server Action \"x\" was not found on the server."), true)).toBe("skew");
    expect(getUpdateState()).toEqual({ available: true, skew: true });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await settle();
    watch.stop();
  });

  it("a ChunkLoadError is skew; a plain error is not (no notice)", () => {
    expect(noteAppError(Object.assign(new Error("chunk"), { name: "ChunkLoadError" }), true)).toBe("skew");
    resetUpdateStateForTests();
    expect(noteAppError(new Error("synthetic"), true)).toBe("other");
    expect(getUpdateState()).toEqual({ available: false, skew: false });
  });

  it("startSkewGuard listens to unhandledrejection and error, and stops", () => {
    const target = new EventTarget();
    const stop = startSkewGuard(target as unknown as Window);
    const event = Object.assign(new Event("unhandledrejection"), { reason: new UnrecognizedActionError("x") });
    target.dispatchEvent(event);
    expect(getUpdateState().skew).toBe(true);
    resetUpdateStateForTests();
    stop();
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new UnrecognizedActionError("x") }));
    expect(getUpdateState().skew).toBe(false);
  });
});
