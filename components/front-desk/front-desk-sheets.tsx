"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { readShortcutsEnabled, ShortcutSheet } from "@/components/today/shortcut-sheet";
import { shortcutFor, type ShortcutAction } from "./shortcuts";
import { RegisterPatientSheet } from "./register-patient-sheet";
import { WalkInSheet } from "./walk-in-sheet";

/**
 * FrontDeskSheets (V2-08 08-02, 08-03b, R-13): the sheets of the front desk are search-param routes, hosted once in the
 * dashboard layout, so every entry point (Today, Schedule, Patients, the palette, "+ New", a patient profile) is a plain
 * link and a refresh keeps the sheet open. Hosted here: `?new=1` (register a patient; `phone` and `name` prefill it, see
 * `registerHref`) and `?walkin=1` (the walk-in sheet); the booking and reschedule sheets join in 08-04b.
 *
 * Closing a sheet removes its parameters from the URL (`replace`, so Back does not reopen it). The single-key shortcuts
 * (W, N, ?; `shortcuts.ts`) open the same sheets by adding the parameter to the current address.
 */
const SHEET_PARAMS = ["new", "phone", "name", "walkin"] as const;

function Sheets({ canRegister, canWalkIn }: { canRegister: boolean; canWalkIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const registerOpen = canRegister && params.get("new") === "1";
  const walkInOpen = canWalkIn && params.get("walkin") === "1";
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOn, setShortcutsOn] = useState(false);

  useEffect(() => {
    const sync = () => setShortcutsOn(readShortcutsEnabled());
    const first = setTimeout(sync, 0);
    const query = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    query.addEventListener("change", sync);
    return () => {
      clearTimeout(first);
      query.removeEventListener("change", sync);
    };
  }, []);

  const query = params.toString();
  useEffect(() => {
    const open = (key: "new" | "walkin") => {
      const next = new URLSearchParams(query);
      next.set(key, "1");
      router.push(`${pathname}?${next.toString()}`);
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action: ShortcutAction | null = shortcutFor(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          isComposing: event.isComposing,
          targetIsEditable: Boolean(target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")),
          dialogOpen: document.querySelector("[role=dialog], [role=alertdialog]") !== null,
        },
        shortcutsOn,
      );
      if (!action) return;
      if (action === "help") setHelpOpen(true);
      else if (action === "walkin" && canWalkIn) open("walkin");
      else if (action === "new" && canRegister) open("new");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, pathname, router, shortcutsOn, canWalkIn, canRegister]);

  const close = () => {
    const next = new URLSearchParams(params.toString());
    for (const key of SHEET_PARAMS) next.delete(key);
    const remaining = next.toString();
    router.replace(remaining ? `${pathname}?${remaining}` : pathname);
  };

  const phone = params.get("phone") ?? "";
  const name = params.get("name") ?? "";
  return (
    <>
      <RegisterPatientSheet
        // A new key per prefill, so a link with another number starts a fresh form.
        key={`${phone}|${name}`}
        open={registerOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        defaultValues={{ phone, name }}
      />
      <WalkInSheet
        open={walkInOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      />
      <ShortcutSheet open={helpOpen} onOpenChange={setHelpOpen} enabled={shortcutsOn} onChange={setShortcutsOn} />
    </>
  );
}

export function FrontDeskSheets({ canRegister, canWalkIn }: { canRegister: boolean; canWalkIn: boolean }) {
  return (
    <Suspense fallback={null}>
      <Sheets canRegister={canRegister} canWalkIn={canWalkIn} />
    </Suspense>
  );
}
