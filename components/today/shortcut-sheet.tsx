"use client";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { Switch } from "@/components/ui/switch";
import { SHORTCUTS, shortcutsEnabled } from "@/components/front-desk/shortcuts";
import { readDevicePref, writeDevicePref } from "@/lib/pwa/device-prefs";

/**
 * The keyboard shortcut list and its per-device switch (V2-08 08-03b, R-13; UI-SPEC §8). The switch writes
 * `clinicos.pref.shortcuts` ("on" or "off"); `onChange` tells the host so the new value applies at once.
 */
export interface ShortcutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the shortcuts are on now (the host's reading of the stored choice and the device). */
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** The list to show (default: the front desk's). The consult passes its own (V2-09b 09B-02b). */
  shortcuts?: readonly { key: string; label: string }[];
  /** The line under the switch (default: the front desk's). */
  note?: string;
}

export function ShortcutSheet({
  open,
  onOpenChange,
  enabled,
  onChange,
  shortcuts = SHORTCUTS,
  note = "W and N work when no field is focused. The ? key always opens this list.",
}: ShortcutSheetProps) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-shortcut-sheet="" aria-describedby={undefined}>
        <ResponsiveSheetHeader title="Keyboard shortcuts" />
        <ResponsiveSheetBody>
          <ul className="flex flex-col divide-y divide-border">
            {shortcuts.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 py-2.5 text-body-md text-fg">
                <span>{s.label}</span>
                <kbd className="rounded-sm border border-border bg-surface-soft px-1.5 py-0.5 text-label font-medium text-fg">{s.key}</kbd>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-border pt-4">
            <Switch
              label="Use single-key shortcuts on this device"
              checked={enabled}
              onCheckedChange={(next) => {
                writeDevicePref("clinicos.pref.shortcuts", next ? "on" : "off");
                onChange(next);
              }}
            />
            <p className="mt-1 text-label text-fg-muted">{note}</p>
          </div>
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

/** The stored choice resolved against this device (a fine pointer at 1024 px and up is the default). */
export function readShortcutsEnabled(): boolean {
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches;
  return shortcutsEnabled(readDevicePref("clinicos.pref.shortcuts"), wide);
}
