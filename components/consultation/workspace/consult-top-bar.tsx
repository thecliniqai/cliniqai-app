import type { ReactNode } from "react";
import { PatientIdentityHeader, type PatientIdentity } from "@/components/clinical/patient-identity-header";
import { TokenChip } from "@/components/clinical/token-chip";

/**
 * The consult's top bar (06-UI-SPEC §7, V2-09b R-7): the compact patient identity (name 14/600 up to two lines, meta 12 muted), the token, the record
 * state chips (status, signed, amending), the save state and the actions of the record state. It sits in the sticky header with the allergy strip, below the
 * shell's own bar, which carries the one Back control (06-09e M1, `design-review-09e.spec.ts`: the v1 in-page arrows are gone, so there is
 * exactly one Back and no second one here).
 */
export function ConsultTopBar({
  patient,
  token,
  status,
  chips,
  saveStatus,
  actions,
}: {
  patient: PatientIdentity;
  token?: number | null;
  /** The visit status for the token's border hue. */
  status: string;
  /** StatusChip, signed chip, amending chip. */
  chips?: ReactNode;
  /** The `SaveStatus` slot (a fixed width from md up so the controls beside it never move). */
  saveStatus?: ReactNode;
  /** The buttons of the record state. */
  actions?: ReactNode;
}) {
  return (
    <div
      data-consult-top-bar=""
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-2 md:flex-nowrap"
    >
      <PatientIdentityHeader
        variant="compact"
        nameHeading={1}
        patient={patient}
        className="min-w-0 flex-1 basis-44"
        context={
          <>
            {token ? <TokenChip token={token} status={status} size="row" /> : null}
            {chips}
          </>
        }
      />
      <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2">
        {saveStatus}
        {actions}
      </div>
    </div>
  );
}
