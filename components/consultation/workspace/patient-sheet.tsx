"use client";

import { ResponsiveSheet, ResponsiveSheetBody, ResponsiveSheetContent, ResponsiveSheetHeader } from "@/components/ui/responsive-sheet";
import { PatientContext, type PatientContextProps } from "./patient-context";

/**
 * The Patient sheet (06-UI-SPEC §7): the patient's context in a `ResponsiveSheet`, opened from the top bar's "Patient" button at 768 to 1179 px and from the
 * Finish bar below 768 (a bottom drawer there). Closing returns focus to the button that opened it. At 1180 px and up the patient column replaces it.
 */
export function PatientSheet({ open, onOpenChange, ...context }: { open: boolean; onOpenChange: (open: boolean) => void } & PatientContextProps) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-patient-sheet="">
        <ResponsiveSheetHeader title="Patient" description={context.patient.full_name} />
        <ResponsiveSheetBody>
          <PatientContext {...context} />
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
