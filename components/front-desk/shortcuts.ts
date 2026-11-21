/**
 * Single-key shortcuts of the front desk (V2-08 08-03b, R-13; UI-SPEC §8): W opens the walk-in sheet, B the booking sheet, N the register sheet,
 * `?` the list. They sit behind a per-device switch (`clinicos.pref.shortcuts`, "on" or "off"); with no stored choice they
 * are on for a fine pointer at 1024 px and up, and off on touch devices and narrow windows. Pure: the keyboard listener
 * (`front-desk-sheets.tsx`) feeds it the event's facts. `tests/today/shortcuts.spec.ts`.
 */
export type ShortcutAction = "walkin" | "book" | "new" | "help";

export const SHORTCUTS: readonly { key: string; action: ShortcutAction; label: string }[] = [
  { key: "W", action: "walkin", label: "Add a walk-in" },
  { key: "B", action: "book", label: "Book an appointment" },
  { key: "N", action: "new", label: "Register a patient" },
  { key: "?", action: "help", label: "Show these shortcuts" },
];

/** Whether W, B and N are live: the stored choice wins; otherwise on for a fine pointer at 1024 px and up. */
export function shortcutsEnabled(stored: string | null, finePointerWide: boolean): boolean {
  if (stored === "on") return true;
  if (stored === "off") return false;
  return finePointerWide;
}

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** The element that has focus: typing in a field must never trigger a shortcut. */
  targetIsEditable: boolean;
  /** A dialog or sheet is open. */
  dialogOpen: boolean;
  isComposing?: boolean;
}

/**
 * The action a key press asks for, or null. `?` always works (it is how the switch is reached); W, B and N need the
 * shortcuts to be enabled, a free keyboard (no field focused, no sheet open) and no modifier.
 */
export function shortcutFor(event: ShortcutKeyEvent, enabled: boolean): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.targetIsEditable) return null;
  if (event.key === "?") return event.dialogOpen ? null : "help";
  if (!enabled || event.dialogOpen) return null;
  const key = event.key.toLowerCase();
  if (key === "w") return "walkin";
  if (key === "b") return "book";
  if (key === "n") return "new";
  return null;
}
