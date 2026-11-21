"use client";

import { useEffect, useRef } from "react";
import { readShortcutsEnabled } from "@/components/today/shortcut-sheet";

/**
 * The consult's keyboard shortcuts (06-UI-SPEC §7 and §8, V2-09b R-7).
 *  - Alt+1 to Alt+5 always work, in a field or not (not behind an open dialog, which holds focus), and move focus to the heading of the section (`onSection(n)`). Matched on `event.code`
 *    (`Digit1`), not `event.key`: on macOS Alt+1 types "¡".
 *  - M (the medicine search), F (Finish visit) work only behind the per-device switch (`clinicos.pref.shortcuts`, the one the front desk uses), with no
 *    modifier, no field focused and no dialog open. `/` is reserved for the consult command bar of 09B-04b and does nothing yet.
 *  - `?` always lists them (it is how the switch is reached).
 */
export const SECTION_SHORTCUT_COUNT = 5;

type Facts = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code">;

/** The section number (1 to 5) an Alt+digit keydown asks for, or null. */
export function sectionShortcut(event: Facts): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= SECTION_SHORTCUT_COUNT ? n : null;
}

export type ConsultKeyAction = "medicine" | "finish" | "help" | "command";

export interface ConsultKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Focus is in a text field, select or editable element: typing must never trigger a shortcut. */
  targetIsEditable: boolean;
  /** A dialog or sheet is open. */
  dialogOpen: boolean;
  isComposing?: boolean;
}

/** The single-key action a key press asks for, or null (pure; `consult-shortcuts.spec.ts`). `command` is `/`, reserved: the host ignores it until 09B-04b. */
export function singleKeyShortcut(event: ConsultKeyEvent, enabled: boolean): ConsultKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.targetIsEditable) return null;
  if (event.key === "?") return event.dialogOpen ? null : "help";
  if (!enabled || event.dialogOpen) return null;
  if (event.key === "/") return "command";
  const key = event.key.toLowerCase();
  if (key === "m") return "medicine";
  if (key === "f") return "finish";
  return null;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox']") !== null;
}

/** What the handler asks the page about; the browser's answers in the hook, a fake document's in `consult-shortcuts.spec.ts`. */
export interface ShortcutEnvironment {
  isEditable: (target: EventTarget | null) => boolean;
  dialogOpen: () => boolean;
  shortcutsEnabled: () => boolean;
}

export type ShortcutKeydown = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target" | "isComposing"> & {
  preventDefault: () => void;
};

/** The keydown handler: Alt+1 to Alt+5 first (always), then the single keys. It prevents the default only for a key it acted on. */
export function createShortcutHandler(
  options: () => { onSection: (n: number) => void; onAction: (action: ConsultKeyAction) => void },
  env: ShortcutEnvironment,
): (event: ShortcutKeydown) => void {
  return (event) => {
    const n = sectionShortcut(event);
    if (n !== null) {
      // Behind an open dialog or sheet focus belongs to it (it traps focus): the page does not move.
      if (env.dialogOpen()) return;
      event.preventDefault();
      options().onSection(n);
      return;
    }
    const action = singleKeyShortcut(
      {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        targetIsEditable: env.isEditable(event.target),
        dialogOpen: env.dialogOpen(),
        isComposing: event.isComposing,
      },
      env.shortcutsEnabled(),
    );
    if (action === null) return;
    event.preventDefault();
    options().onAction(action);
  };
}

export function useConsultShortcuts(options: {
  onSection: (n: number) => void;
  onAction: (action: ConsultKeyAction) => void;
}) {
  const ref = useRef(options);
  useEffect(() => {
    ref.current = options;
  });
  useEffect(() => {
    const handler = createShortcutHandler(() => ref.current, {
      isEditable,
      dialogOpen: () => document.querySelector("[role='dialog'], [role='alertdialog']") !== null,
      shortcutsEnabled: readShortcutsEnabled,
    });
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
