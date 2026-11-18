import { useSyncExternalStore } from "react";

/**
 * The palette shortcut's label by platform (06-UI-SPEC §6 TopBar, CD-20): "⌘K" on Apple platforms, "Ctrl K"
 * elsewhere. One source for every place the hint is drawn, so a screen never shows both (06-09e, design review L3).
 * The server render and hydration say "Ctrl K"; the platform's label follows after hydration.
 */
export function shortcutLabelFor(platform: string): "⌘K" | "Ctrl K" {
  return /Mac|iPhone|iPad/.test(platform) ? "⌘K" : "Ctrl K";
}

const noop = () => () => {};

export function useShortcutLabel(): "⌘K" | "Ctrl K" {
  return useSyncExternalStore(
    noop,
    () => shortcutLabelFor(navigator.platform),
    () => "Ctrl K",
  );
}
