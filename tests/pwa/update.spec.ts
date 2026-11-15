/**
 * V2-06 06-06 (PWA_STRATEGY §3.7 steps 1, 3, 4; R-28, R-29): the update state and the safe-point apply
 * (`lib/pwa/update.ts`) with the dirty guard (`lib/pwa/dirty-guard.ts`), in Node with injected worker calls.
 *
 * - the safe point: an available update is applied on a route change only with no unsaved input and nothing in flight,
 *   and never after a skew notice;
 * - applying posts `SKIP_WAITING` to a waiting worker, waits for the controller change, then reloads; without a
 *   waiting worker it just reloads; a failure still reloads;
 * - a waiting worker marks an update only when the page is already controlled (the first install is no update);
 * - `update()` failures never throw;
 * - mismatch detection ignores a missing `data-dpl-id` (in session-status.spec: `isDeploymentMismatch`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyUpdate,
  checkForWorkerUpdate,
  getUpdateState,
  markSkew,
  markUpdateAvailable,
  onRouteChange,
  resetApplyForTests,
  resetUpdateStateForTests,
  subscribeUpdate,
  watchRegistration,
  type ApplyDeps,
} from "@/lib/pwa/update";
import { registerBusy, resetDirtyGuardForTests, startDirtyGuard } from "@/lib/pwa/dirty-guard";
import { isDeploymentMismatch } from "@/lib/pwa/session-status";

function applyDeps(waiting: boolean) {
  const calls: string[] = [];
  const deps: ApplyDeps = {
    waitingWorker: () => (waiting ? { postMessage: (m: unknown) => calls.push(`post ${JSON.stringify(m)}`) } : null),
    controllerChanged: async () => {
      calls.push("controllerchange");
    },
    reload: () => calls.push("reload"),
  };
  return { deps, calls };
}

/** A fake document: EventTarget plus a form whose input events bubble to it. */
function fakeDom() {
  const doc = new EventTarget();
  const form = Object.assign(new EventTarget(), { isConnected: true });
  const field = { form, closest: () => null };
  const loose = { form: null, closest: () => null };
  const fire = (type: string, target: unknown) => {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    doc.dispatchEvent(event);
  };
  return { doc, form, field, loose, fire };
}

beforeEach(() => {
  resetUpdateStateForTests();
  resetApplyForTests();
  resetDirtyGuardForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("safe-point apply on a route change", () => {
  it("nothing available → no reload", () => {
    const { deps, calls } = applyDeps(true);
    expect(onRouteChange(deps)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("available, nothing typed, nothing in flight → SKIP_WAITING, controller change, reload", async () => {
    markUpdateAvailable();
    const { deps, calls } = applyDeps(true);
    expect(onRouteChange(deps)).toBe(true);
    await vi.waitFor(() => expect(calls).toEqual(['post {"type":"SKIP_WAITING"}', "controllerchange", "reload"]));
  });

  it("a form with typed input blocks the reload while it is on screen and on the navigation that removes it; the next applies", async () => {
    const dom = fakeDom();
    const stop = startDirtyGuard(dom.doc as never);
    dom.fire("input", dom.field);
    markUpdateAvailable();
    const first = applyDeps(true);
    expect(onRouteChange(first.deps)).toBe(false);
    expect(first.calls).toEqual([]);
    // The form is gone after this navigation (as when the user leaves the page): still no reload on that change.
    dom.form.isConnected = false;
    expect(onRouteChange(applyDeps(false).deps)).toBe(false);
    const third = applyDeps(false);
    expect(onRouteChange(third.deps)).toBe(true);
    await vi.waitFor(() => expect(third.calls).toEqual(["reload"]));
    stop();
  });

  it("a submitted or reset form is clean again", async () => {
    const dom = fakeDom();
    const stop = startDirtyGuard(dom.doc as never);
    dom.fire("change", dom.field);
    dom.fire("submit", dom.form);
    markUpdateAvailable();
    const { deps, calls } = applyDeps(false);
    expect(onRouteChange(deps)).toBe(true);
    await vi.waitFor(() => expect(calls).toEqual(["reload"]));
    stop();
  });

  it("input outside a form blocks only until the navigation", () => {
    const dom = fakeDom();
    const stop = startDirtyGuard(dom.doc as never);
    dom.fire("input", dom.loose);
    markUpdateAvailable();
    expect(onRouteChange(applyDeps(false).deps)).toBe(false);
    expect(onRouteChange(applyDeps(false).deps)).toBe(true);
    stop();
  });

  it("a field inside [data-dirty-guard=ignore] never counts", () => {
    const dom = fakeDom();
    const stop = startDirtyGuard(dom.doc as never);
    dom.fire("input", { form: dom.form, closest: (s: string) => (s.includes("dirty-guard") ? {} : null) });
    markUpdateAvailable();
    expect(onRouteChange(applyDeps(false).deps)).toBe(true);
    stop();
  });

  it("a command in flight blocks the reload until it settles", () => {
    markUpdateAvailable();
    const done = registerBusy();
    expect(onRouteChange(applyDeps(false).deps)).toBe(false);
    done();
    done();
    expect(onRouteChange(applyDeps(false).deps)).toBe(true);
  });

  it("after a skew notice nothing reloads by itself, even with nothing typed", () => {
    markSkew();
    expect(getUpdateState()).toEqual({ available: true, skew: true });
    const { deps, calls } = applyDeps(true);
    expect(onRouteChange(deps)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("applyUpdate (the toast's Reload)", () => {
  it("without a waiting worker: reload only", async () => {
    const { deps, calls } = applyDeps(false);
    await applyUpdate(deps);
    expect(calls).toEqual(["reload"]);
  });

  it("a failing postMessage still reloads", async () => {
    const calls: string[] = [];
    await applyUpdate({
      waitingWorker: () => ({
        postMessage: () => {
          throw new Error("synthetic");
        },
      }),
      controllerChanged: async () => undefined,
      reload: () => calls.push("reload"),
    });
    expect(calls).toEqual(["reload"]);
  });
});

describe("the service worker side", () => {
  function fakeRegistration(waiting: boolean) {
    const target = new EventTarget();
    const worker = Object.assign(new EventTarget(), { state: "installing" as string });
    const reg = Object.assign(target, {
      waiting: waiting ? ({} as ServiceWorker) : null,
      installing: worker as unknown as ServiceWorker,
      update: vi.fn(async () => reg as unknown as ServiceWorkerRegistration),
    });
    return { reg, worker };
  }

  it("a worker waiting behind the active one marks an update; the first install (no controller) does not", () => {
    watchRegistration(fakeRegistration(true).reg as never, () => false);
    expect(getUpdateState().available).toBe(false);
    watchRegistration(fakeRegistration(true).reg as never, () => true);
    expect(getUpdateState().available).toBe(true);
  });

  it("an update found later marks it once the new worker is installed", () => {
    const { reg, worker } = fakeRegistration(false);
    watchRegistration(reg as never, () => true);
    reg.dispatchEvent(new Event("updatefound"));
    expect(getUpdateState().available).toBe(false);
    reg.waiting = {} as ServiceWorker;
    worker.state = "installed";
    worker.dispatchEvent(new Event("statechange"));
    expect(getUpdateState().available).toBe(true);
  });

  it("update() rejections are swallowed (offline); null registration is a no-op", async () => {
    const reg = { update: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) };
    expect(() => checkForWorkerUpdate(reg as never)).not.toThrow();
    expect(() => checkForWorkerUpdate(null)).not.toThrow();
    await Promise.resolve();
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("subscribers hear a change once; an unchanged state does not notify", () => {
    const listener = vi.fn();
    const stop = subscribeUpdate(listener);
    markUpdateAvailable();
    markUpdateAvailable();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("mismatch detection ignores a missing data-dpl-id instead of looping", () => {
    expect(isDeploymentMismatch("e2e-new", undefined)).toBe(false);
    expect(isDeploymentMismatch("e2e-new", "e2e-local-deployment")).toBe(true);
  });
});
