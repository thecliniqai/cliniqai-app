import { PatientContext, type PatientContextProps } from "./patient-context";

/**
 * The patient column (06-UI-SPEC §7; 1180 px and up): 264 px on `surface-soft`, a right hairline, padding 14 16 24, and it scrolls on its own, beside
 * the note. Below 1180 px the same content is the Patient sheet (`patient-sheet.tsx`).
 */
export function PatientColumn(props: PatientContextProps) {
  return (
    <aside
      aria-label="Patient"
      data-patient-column=""
      className="hidden min-h-0 w-context-pane shrink-0 overflow-y-auto overscroll-contain border-r border-border bg-surface-soft px-4 pt-3.5 pb-6 min-[1180px]:block"
    >
      <PatientContext {...props} />
    </aside>
  );
}
