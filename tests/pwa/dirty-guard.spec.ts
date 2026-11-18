/**
 * V2-06 06-06 (PWA §3.7 step 4): the dirty guard (`lib/pwa/dirty-guard.ts`) on a fake document: input marks the
 * enclosing form dirty, submit/reset clear it, input outside a form marks the page until the navigation, ignored
 * regions never count, busy commands block, and the navigation verdict forgets what the navigation discarded.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  hasUnsavedInput,
  isBusy,
  registerBusy,
  resetDirtyGuardForTests,
  startDirtyGuard,
  takeNavigationVerdict,
} from "@/lib/pwa/dirty-guard";

function setup() {
  const doc = new EventTarget();
  const fire = (type: string, target: unknown) => {
    const event = new Event(type);
    Object.defineProperty(event, "target", { value: target });
    doc.dispatchEvent(event);
  };
  const stop = startDirtyGuard(doc as never);
  return { doc, fire, stop };
}

const formA = () => Object.assign(new EventTarget(), { isConnected: true });

beforeEach(() => resetDirtyGuardForTests());

describe("dirty guard", () => {
  it("input marks the field's form dirty; its submit clears it", () => {
    const { fire, stop } = setup();
    const form = formA();
    fire("input", { form, closest: () => null });
    expect(hasUnsavedInput()).toBe(true);
    fire("submit", form);
    expect(hasUnsavedInput()).toBe(false);
    stop();
  });

  it("change marks dirty too; reset clears", () => {
    const { fire, stop } = setup();
    const form = formA();
    fire("change", { form, closest: () => null });
    expect(hasUnsavedInput()).toBe(true);
    fire("reset", form);
    expect(hasUnsavedInput()).toBe(false);
    stop();
  });

  it("a field without .form is matched to its closest <form>", () => {
    const { fire, stop } = setup();
    const form = formA();
    fire("input", { closest: (s: string) => (s === "form" ? form : null) });
    expect(hasUnsavedInput()).toBe(true);
    fire("submit", form);
    expect(hasUnsavedInput()).toBe(false);
    stop();
  });

  it("submitting another form leaves this one dirty", () => {
    const { fire, stop } = setup();
    const a = formA();
    const b = formA();
    fire("input", { form: a, closest: () => null });
    fire("submit", b);
    expect(hasUnsavedInput()).toBe(true);
    stop();
  });

  it("input outside any form marks the page until the next navigation verdict", () => {
    const { fire, stop } = setup();
    fire("input", { form: null, closest: () => null });
    expect(takeNavigationVerdict()).toEqual({ safe: false });
    expect(takeNavigationVerdict()).toEqual({ safe: true });
    stop();
  });

  it("a dirty form still in the document keeps blocking; one the navigation removed is forgotten after one verdict", () => {
    const { fire, stop } = setup();
    const kept = formA();
    fire("input", { form: kept, closest: () => null });
    expect(takeNavigationVerdict().safe).toBe(false);
    expect(takeNavigationVerdict().safe).toBe(false);
    kept.isConnected = false;
    expect(takeNavigationVerdict().safe).toBe(false);
    expect(takeNavigationVerdict().safe).toBe(true);
    stop();
  });

  it("fields inside [data-dirty-guard=ignore] never count", () => {
    const { fire, stop } = setup();
    fire("input", { form: formA(), closest: (s: string) => (s === '[data-dirty-guard="ignore"]' ? {} : null) });
    expect(hasUnsavedInput()).toBe(false);
    stop();
  });

  it("registerBusy: in flight until its end is called (once)", () => {
    const end = registerBusy();
    const end2 = registerBusy();
    expect(isBusy()).toBe(true);
    end();
    end();
    expect(isBusy()).toBe(true);
    end2();
    expect(isBusy()).toBe(false);
    expect(takeNavigationVerdict().safe).toBe(true);
  });

  it("after stop() edits are no longer tracked", () => {
    const { fire, stop } = setup();
    stop();
    fire("input", { form: formA(), closest: () => null });
    expect(hasUnsavedInput()).toBe(false);
  });
});
