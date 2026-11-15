/**
 * Unsaved-input and in-flight tracking for the safe-point update (V2-06 06-06; PWA_STRATEGY §3.7 step 4, R-28, R-29):
 * the app never reloads itself over typed input or a running command.
 *
 * - A document-level `input`/`change` listener (capture phase) marks the enclosing `<form>` dirty until that form's
 *   `submit` or `reset`; input outside any form marks the page dirty until the next navigation. Only user edits fire
 *   these events, so a value the app sets in code never counts.
 * - A field inside `[data-dirty-guard="ignore"]` never counts (search boxes whose text is not work to keep).
 * - {@link registerBusy} marks a command in flight (V2-07/V2-08 commands use it); the returned function ends it.
 * - {@link takeNavigationVerdict} is called once per route change: it answers whether the page had unsaved input or a
 *   command in flight up to that change, then forgets what the navigation discarded (page-level input, forms no longer
 *   in the document). So a form left dirty on the previous page still blocks the reload on this navigation
 *   (conservative), and the next navigation may apply the update.
 *
 * Pure DOM, no React; `tests/pwa/dirty-guard.spec.ts` drives it with a fake document.
 */
export interface DirtyGuardTarget {
  addEventListener: (type: string, listener: (event: Event) => void, options?: { capture: boolean }) => void;
  removeEventListener: (type: string, listener: (event: Event) => void, options?: { capture: boolean }) => void;
}

interface FormLike {
  isConnected?: boolean;
}

const IGNORE_SELECTOR = '[data-dirty-guard="ignore"]';

const dirtyForms = new Set<FormLike>();
let pageDirty = false;
let busy = 0;

function closest(target: EventTarget | null, selector: string): Element | null {
  const el = target as (Element & { closest?: (s: string) => Element | null }) | null;
  return el && typeof el.closest === "function" ? el.closest(selector) : null;
}

function formOf(target: EventTarget | null): FormLike | null {
  const field = target as { form?: FormLike | null } | null;
  if (field && field.form) return field.form;
  return closest(target, "form");
}

function onEdit(event: Event): void {
  if (closest(event.target, IGNORE_SELECTOR)) return;
  const form = formOf(event.target);
  if (form) dirtyForms.add(form);
  else pageDirty = true;
}

function onSubmitOrReset(event: Event): void {
  dirtyForms.delete(event.target as FormLike);
}

/** Capture phase; an options object (Node's EventTarget does not match a boolean `capture` on removal). */
const CAPTURE = { capture: true };

/** Starts listening on `doc`; returns the function that stops. */
export function startDirtyGuard(doc: DirtyGuardTarget = document): () => void {
  doc.addEventListener("input", onEdit, CAPTURE);
  doc.addEventListener("change", onEdit, CAPTURE);
  doc.addEventListener("submit", onSubmitOrReset, CAPTURE);
  doc.addEventListener("reset", onSubmitOrReset, CAPTURE);
  return () => {
    doc.removeEventListener("input", onEdit, CAPTURE);
    doc.removeEventListener("change", onEdit, CAPTURE);
    doc.removeEventListener("submit", onSubmitOrReset, CAPTURE);
    doc.removeEventListener("reset", onSubmitOrReset, CAPTURE);
  };
}

/** True while any form or the page holds unsaved input. */
export function hasUnsavedInput(): boolean {
  return pageDirty || dirtyForms.size > 0;
}

/** Marks one command in flight; call the returned function exactly when it settles (idempotent). */
export function registerBusy(): () => void {
  busy += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busy -= 1;
  };
}

export function isBusy(): boolean {
  return busy > 0;
}

/** Called once per route change: whether it was safe to reload (no unsaved input, nothing in flight), then forgets. */
export function takeNavigationVerdict(): { safe: boolean } {
  const safe = !hasUnsavedInput() && !isBusy();
  pageDirty = false;
  for (const form of [...dirtyForms]) if (form.isConnected === false) dirtyForms.delete(form);
  return { safe };
}

/** For tests only. */
export function resetDirtyGuardForTests(): void {
  dirtyForms.clear();
  pageDirty = false;
  busy = 0;
}
