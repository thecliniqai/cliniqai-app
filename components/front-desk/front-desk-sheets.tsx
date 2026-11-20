"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RegisterPatientSheet } from "./register-patient-sheet";

/**
 * FrontDeskSheets (V2-08 08-02, R-13): the sheets of the front desk are search-param routes, hosted once in the dashboard
 * layout, so every entry point (Today, Schedule, Patients, the palette, "+ New", a patient profile) is a plain link and a
 * refresh keeps the sheet open. This plan hosts `?new=1` (register a patient; `phone` and `name` prefill it, see
 * `registerHref`); the walk-in, booking and reschedule sheets join in 08-03b and 08-04b.
 *
 * Closing a sheet removes its parameters from the URL (`replace`, so Back does not reopen it).
 */
const SHEET_PARAMS = ["new", "phone", "name"] as const;

function Sheets({ canRegister }: { canRegister: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const registerOpen = canRegister && params.get("new") === "1";

  const close = () => {
    const next = new URLSearchParams(params.toString());
    for (const key of SHEET_PARAMS) next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const phone = params.get("phone") ?? "";
  const name = params.get("name") ?? "";
  return (
    <RegisterPatientSheet
      // A new key per prefill, so a link with another number starts a fresh form.
      key={`${phone}|${name}`}
      open={registerOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      defaultValues={{ phone, name }}
    />
  );
}

export function FrontDeskSheets({ canRegister }: { canRegister: boolean }) {
  return (
    <Suspense fallback={null}>
      <Sheets canRegister={canRegister} />
    </Suspense>
  );
}
