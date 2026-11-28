"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { readShortcutsEnabled, ShortcutSheet } from "@/components/today/shortcut-sheet";
import { shortcutFor, type ShortcutAction } from "./shortcuts";
import { BookingSheet } from "./booking-sheet";
import { RegisterPatientSheet } from "./register-patient-sheet";
import { RescheduleSheet } from "./reschedule-sheet";
import { WalkInSheet } from "./walk-in-sheet";

/**
 * FrontDeskSheets (V2-08 08-02, 08-03b, R-13): the sheets of the front desk are search-param routes, hosted once in the
 * dashboard layout, so every entry point (Today, Schedule, Patients, the palette, "+ New", a patient profile) is a plain
 * link and a refresh keeps the sheet open. Hosted here: `?new=1` (register a patient; `phone` and `name` prefill it, see
 * `registerHref`), `?walkin=1` (the walk-in sheet), `?book=1` (booking; `patient`, `doctor`, `date` and `time` prefill it)
 * and `?reschedule=<visitId>` (move an appointment; with `date` and `time`, V2-09f, that slot comes chosen).
 *
 * Closing a sheet removes its parameters from the URL (`replace`, so Back does not reopen it), except `date` and `doctor`:
 * the Schedule uses those two for its own view, and the booking sheet only reads them. The single-key shortcuts (W, B, N, ?;
 * `shortcuts.ts`) open the same sheets by adding the parameter to the current address.
 */
const SHEET_PARAMS = ["new", "phone", "name", "walkin", "book", "patient", "time", "reschedule"] as const;

function Sheets({ canRegister, canWalkIn, canBook }: { canRegister: boolean; canWalkIn: boolean; canBook: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const registerOpen = canRegister && params.get("new") === "1";
  const walkInOpen = canWalkIn && params.get("walkin") === "1";
  const bookOpen = canBook && params.get("book") === "1";
  const rescheduleId = canBook ? params.get("reschedule") : null;
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
    const open = (key: "new" | "walkin" | "book") => {
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
      else if (action === "book" && canBook) open("book");
      else if (action === "new" && canRegister) open("new");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, pathname, router, shortcutsOn, canWalkIn, canBook, canRegister]);

  const close = () => {
    const next = new URLSearchParams(params.toString());
    for (const key of SHEET_PARAMS) next.delete(key);
    const remaining = next.toString();
    router.replace(remaining ? `${pathname}?${remaining}` : pathname);
  };

  // V2-09f: the week grid's "Move here" opens the move with its slot chosen (`?reschedule=<id>&date&time`); both must be well formed.
  const askedDate = params.get("date") ?? "";
  const askedTime = params.get("time") ?? "";
  const rescheduleDefaults =
    rescheduleId && /^\d{4}-\d{2}-\d{2}$/.test(askedDate) && /^([01]\d|2[0-3]):[0-5]\d$/.test(askedTime) ? { date: askedDate, time: askedTime } : undefined;
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
      <BookingSheet
        open={bookOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        defaults={{
          patientId: params.get("patient") ?? undefined,
          doctorId: params.get("doctor") ?? undefined,
          date: /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? (params.get("date") ?? undefined) : undefined,
          time: /^([01]\d|2[0-3]):[0-5]\d$/.test(params.get("time") ?? "") ? (params.get("time") ?? undefined) : undefined,
        }}
      />
      <RescheduleSheet
        visitId={rescheduleId}
        defaults={rescheduleDefaults}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      />
      <ShortcutSheet open={helpOpen} onOpenChange={setHelpOpen} enabled={shortcutsOn} onChange={setShortcutsOn} />
    </>
  );
}

export function FrontDeskSheets({ canRegister, canWalkIn, canBook }: { canRegister: boolean; canWalkIn: boolean; canBook: boolean }) {
  return (
    <Suspense fallback={null}>
      <Sheets canRegister={canRegister} canWalkIn={canWalkIn} canBook={canBook} />
    </Suspense>
  );
}
