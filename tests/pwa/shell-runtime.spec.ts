/**
 * V2-06 06-04b shell runtime rules: refresh on resume (`lib/pwa/resume.ts`), keyboard-aware bars
 * (`lib/pwa/keyboard-aware.ts`) and the in-app Back stack (`lib/nav/back-stack.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import { isLiveView, RESUME_COALESCE_MS, startResumeRefresh, type ResumeDeps } from "@/lib/pwa/resume";
import {
  barsHidden,
  isTextEntry,
  nextViewportState,
  SHOW_DELAY_MS,
  watchKeyboard,
  type KeyboardState,
} from "@/lib/pwa/keyboard-aware";
import { canGoBackInApp, visit } from "@/lib/nav/back-stack";

function resumeHarness(path = "/") {
  let onVisibility = () => {};
  let onOnline = () => {};
  let now = 10_000;
  let visible = true;
  let pathname = path;
  const refresh = vi.fn();
  const deps: ResumeDeps = {
    pathname: () => pathname,
    refresh,
    isVisible: () => visible,
    listen: (v, o) => {
      onVisibility = v;
      onOnline = o;
      return () => {
        onVisibility = () => {};
        onOnline = () => {};
      };
    },
    now: () => now,
  };
  const stop = startResumeRefresh(deps);
  return {
    refresh,
    stop,
    visible: () => onVisibility(),
    online: () => onOnline(),
    hide: () => (visible = false),
    show: () => (visible = true),
    advance: (ms: number) => (now += ms),
    go: (p: string) => (pathname = p),
  };
}

describe("refresh on resume", () => {
  it("live views are Today and the calendar only (the queue and the cabin redirect)", () => {
    for (const p of ["/today", "/calendar", "/today/"]) expect(isLiveView(p), p).toBe(true);
    for (const p of ["/", "/queue", "/cabin"]) expect(isLiveView(p), p).toBe(false);
    for (const p of ["/patients", "/patients/abc", "/consultation/abc", "/settings/clinic", "/visits"]) {
      expect(isLiveView(p), p).toBe(false);
    }
  });

  it("visible → one refresh on a live view; online → one refresh", () => {
    const h = resumeHarness("/today");
    h.visible();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.advance(RESUME_COALESCE_MS + 1);
    h.online();
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("online and visible together refresh once (coalesced)", () => {
    const h = resumeHarness("/today");
    h.online();
    h.visible();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("never refreshes a form or the consult underneath the user, nor while hidden", () => {
    const h = resumeHarness("/patients/new");
    h.visible();
    h.online();
    h.go("/consultation/x");
    h.advance(RESUME_COALESCE_MS + 1);
    h.visible();
    h.go("/today");
    h.hide();
    h.advance(RESUME_COALESCE_MS + 1);
    h.visible();
    expect(h.refresh).not.toHaveBeenCalled();
    h.show();
    h.visible();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("stop() removes the listeners", () => {
    const h = resumeHarness("/today");
    h.stop();
    h.visible();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

const el = (tagName: string, props: Record<string, unknown> = {}) => ({ tagName, ...props }) as unknown as Element;

describe("keyboard-aware bars", () => {
  it("text-entry elements: text-like inputs, textareas, contenteditable; not buttons, checkboxes, read-only fields", () => {
    for (const type of ["text", "search", "email", "tel", "url", "number", "password", "date", ""]) {
      expect(isTextEntry(el("INPUT", { type })), type).toBe(true);
    }
    for (const type of ["checkbox", "radio", "button", "submit", "range", "file", "color", "hidden"]) {
      expect(isTextEntry(el("INPUT", { type })), type).toBe(false);
    }
    expect(isTextEntry(el("INPUT", { type: "text", readOnly: true }))).toBe(false);
    expect(isTextEntry(el("TEXTAREA"))).toBe(true);
    expect(isTextEntry(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTextEntry(el("BUTTON"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });

  it("hidden on phones while a text field has focus; shown again when the keyboard closes or focus leaves", () => {
    const focused: KeyboardState = { textFocused: true, viewportShrunk: null };
    expect(barsHidden(true, focused)).toBe(true);
    expect(barsHidden(false, focused)).toBe(false);
    const up = nextViewportState(focused, 400, 800);
    expect(up.viewportShrunk).toBe(true);
    expect(barsHidden(true, up)).toBe(true);
    const down = nextViewportState(up, 780, 800);
    expect(down.viewportShrunk).toBe(false);
    expect(barsHidden(true, down)).toBe(false);
    expect(barsHidden(true, { textFocused: false, viewportShrunk: null })).toBe(false);
  });

  it("small viewport moves (browser bars) are not the keyboard", () => {
    const focused: KeyboardState = { textFocused: true, viewportShrunk: null };
    expect(nextViewportState(focused, 760, 800)).toEqual(focused);
    expect(nextViewportState({ textFocused: false, viewportShrunk: null }, 300, 800).viewportShrunk).toBeNull();
  });

  it("watchKeyboard follows focusin/focusout and visualViewport resizes; the bars come back only after a delay", () => {
    const handlers: Record<string, (e: Event) => void> = {};
    const vvHandlers: Record<string, () => void> = {};
    const doc = {
      activeElement: el("BODY") as Element | null,
      addEventListener: (t: string, h: (e: Event) => void) => (handlers[t] = h),
      removeEventListener: (t: string) => delete handlers[t],
    };
    const vv = {
      height: 800,
      addEventListener: (t: string, h: () => void) => (vvHandlers[t] = h),
      removeEventListener: (t: string) => delete vvHandlers[t],
    };
    const states: KeyboardState[] = [];
    const pending: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    const stop = watchKeyboard(
      { document: doc as unknown as Document, visualViewport: vv as unknown as VisualViewport },
      (s) => states.push(s),
      {
        schedule: (fn, ms) => {
          const job = { fn, ms, cancelled: false };
          pending.push(job);
          return () => (job.cancelled = true);
        },
      },
    );
    const flush = () => {
      for (const job of pending.splice(0)) if (!job.cancelled) job.fn();
    };
    const input = el("INPUT", { type: "tel" });
    doc.activeElement = input;
    handlers.focusin({ target: input } as unknown as Event);
    expect(states.at(-1)).toEqual({ textFocused: true, viewportShrunk: null });
    vv.height = 420;
    vvHandlers.resize();
    expect(states.at(-1)?.viewportShrunk).toBe(true);
    vv.height = 800;
    vvHandlers.resize();
    expect(states.at(-1)?.viewportShrunk).toBe(false);
    // A tap on a button moves focus away: the bars wait (SHOW_DELAY_MS), so the tap lands on the button.
    doc.activeElement = el("BUTTON");
    handlers.focusout({ target: input } as unknown as Event);
    handlers.focusin({ target: doc.activeElement } as unknown as Event);
    expect(states.at(-1)?.textFocused).toBe(true);
    expect(pending.map((j) => j.ms)).toEqual([SHOW_DELAY_MS]);
    flush();
    expect(states.at(-1)).toEqual({ textFocused: false, viewportShrunk: null });

    // Focus back in a text field within the delay: the scheduled show is cancelled.
    doc.activeElement = input;
    handlers.focusin({ target: input } as unknown as Event);
    handlers.focusout({ target: input } as unknown as Event);
    const second = el("TEXTAREA");
    doc.activeElement = second;
    handlers.focusin({ target: second } as unknown as Event);
    flush();
    expect(states.at(-1)?.textFocused).toBe(true);
    stop();
    expect(Object.keys(handlers)).toEqual([]);
    expect(Object.keys(vvHandlers)).toEqual([]);
  });
});

describe("in-app Back stack", () => {
  it("a fresh launch has no in-app history: Back goes to the nav parent", () => {
    expect(canGoBackInApp(visit([], "/patients/abc"))).toBe(false);
  });

  it("pushes forward navigations, pops a step back, ignores a repeat", () => {
    let s = visit([], "/");
    s = visit(s, "/patients");
    s = visit(s, "/patients/abc");
    expect(s).toEqual(["/", "/patients", "/patients/abc"]);
    expect(canGoBackInApp(s)).toBe(true);
    s = visit(s, "/patients");
    expect(s).toEqual(["/", "/patients"]);
    s = visit(s, "/patients");
    expect(s).toEqual(["/", "/patients"]);
    s = visit(s, "/");
    expect(canGoBackInApp(s)).toBe(false);
  });
});
