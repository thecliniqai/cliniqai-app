"use client";

import { useSyncExternalStore } from "react";

/**
 * Keyboard-aware bars (V2-06 06-04b; PWA_STRATEGY §3.3 "Keyboard", 06-UI-SPEC §6): on a phone the BottomBar steps
 * aside while a text field has focus, so the on-screen keyboard never pushes it over the field being typed into.
 *
 * - Focus on a text-entry element (a text-like `input`, a `textarea`, a contenteditable) hides the bars at once: the
 *   keyboard opens after focus, and `visualViewport` reports it only after the resize animation.
 * - `visualViewport` then tells us whether the keyboard is really up (Safari ignores `interactive-widget`, so this is
 *   the fallback the strategy requires): once the visual viewport has shrunk and grows back while the field still has
 *   focus (the user closed the keyboard with the system Back or the "done" key), the bars come back.
 * - Leaving the field shows them again, after {@link SHOW_DELAY_MS}: a tap on a button below a field moves focus on
 *   `pointerdown`, and a bar appearing at once would slide under the finger before `click` (the tap would land on the
 *   bar). Focus returning to a text field within the delay keeps the bars hidden.
 *
 * Only below 768 px (the BottomBar's widths); the decision itself is {@link barsHidden}, pure and unit-tested.
 */

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** Whether `el` opens the on-screen keyboard. */
export function isTextEntry(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return !(el as HTMLTextAreaElement).readOnly;
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    return !input.readOnly && !NON_TEXT_INPUTS.has((input.type || "text").toLowerCase());
  }
  return (el as HTMLElement).isContentEditable === true;
}

export interface KeyboardState {
  textFocused: boolean;
  /** null: no keyboard signal since the focus; true: the visual viewport shrank; false: it grew back. */
  viewportShrunk: boolean | null;
}

/** The phone bars hide while a text field has focus, unless the viewport says the keyboard was closed again. */
export function barsHidden(narrow: boolean, state: KeyboardState): boolean {
  return narrow && state.textFocused && state.viewportShrunk !== false;
}

/** A shrink of more than 15 % of the resting height is the keyboard (browser bars move a few dozen px at most). */
export const SHRINK_RATIO = 0.85;
/** Back within 10 % of the resting height: the keyboard is down. */
export const RESTORE_RATIO = 0.9;

/** The next state for a visual-viewport height, given the resting (no keyboard) height. */
export function nextViewportState(state: KeyboardState, height: number, resting: number): KeyboardState {
  if (!state.textFocused || resting <= 0) return state;
  if (height < resting * SHRINK_RATIO) return { ...state, viewportShrunk: true };
  if (state.viewportShrunk === true && height >= resting * RESTORE_RATIO) return { ...state, viewportShrunk: false };
  return state;
}

export interface KeyboardWatchTarget {
  document: Pick<Document, "addEventListener" | "removeEventListener" | "activeElement">;
  visualViewport: Pick<VisualViewport, "height" | "addEventListener" | "removeEventListener"> | null;
}

/** How long the bars wait before coming back after a text field loses focus. */
export const SHOW_DELAY_MS = 350;

export interface KeyboardWatchOptions {
  showDelayMs?: number;
  /** Runs `fn` after `ms`; returns the cancel function (injectable for tests). */
  schedule?: (fn: () => void, ms: number) => () => void;
}

const browserSchedule = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/** Watches focus and the visual viewport; calls `onChange` with each new state. Returns the unsubscribe. */
export function watchKeyboard(
  target: KeyboardWatchTarget,
  onChange: (state: KeyboardState) => void,
  { showDelayMs = SHOW_DELAY_MS, schedule = browserSchedule }: KeyboardWatchOptions = {},
): () => void {
  let state: KeyboardState = { textFocused: isTextEntry(target.document.activeElement), viewportShrunk: null };
  let resting = target.visualViewport?.height ?? 0;
  const set = (next: KeyboardState) => {
    if (next.textFocused === state.textFocused && next.viewportShrunk === state.viewportShrunk) return;
    state = next;
    onChange(state);
  };
  let cancelShow: (() => void) | null = null;
  const onFocusIn = (event: Event) => {
    const text = isTextEntry(event.target as Element | null);
    if (text) {
      cancelShow?.();
      cancelShow = null;
      set({ textFocused: true, viewportShrunk: null });
    }
  };
  // Leaving a text field (to a button, the page, another app): show the bars after the delay, unless a text field has
  // focus again by then.
  const onFocusOut = () => {
    if (!state.textFocused) return;
    cancelShow?.();
    cancelShow = schedule(() => {
      cancelShow = null;
      if (!isTextEntry(target.document.activeElement)) set({ textFocused: false, viewportShrunk: null });
    }, showDelayMs);
  };
  const onResize = () => {
    const vv = target.visualViewport;
    if (!vv) return;
    if (!state.textFocused) {
      resting = vv.height;
      return;
    }
    set(nextViewportState(state, vv.height, resting));
  };
  target.document.addEventListener("focusin", onFocusIn);
  target.document.addEventListener("focusout", onFocusOut);
  target.visualViewport?.addEventListener("resize", onResize);
  onChange(state);
  return () => {
    cancelShow?.();
    target.document.removeEventListener("focusin", onFocusIn);
    target.document.removeEventListener("focusout", onFocusOut);
    target.visualViewport?.removeEventListener("resize", onResize);
  };
}

let current: KeyboardState = { textFocused: false, viewportShrunk: null };
const listeners = new Set<() => void>();
let stopWatch: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopWatch && typeof document !== "undefined") {
    stopWatch = watchKeyboard({ document, visualViewport: window.visualViewport ?? null }, (state) => {
      current = state;
      for (const l of [...listeners]) l();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopWatch) {
      stopWatch();
      stopWatch = null;
    }
  };
}

const SERVER_STATE: KeyboardState = { textFocused: false, viewportShrunk: null };

/** The keyboard state for the shell (server and hydration: no field focused). */
export function useKeyboardState(): KeyboardState {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => SERVER_STATE,
  );
}
