import Link from "next/link";
import { FilePenLine } from "lucide-react";
import type { OpenAmendment } from "@/features/today/queries";
import { clinicDateLabel } from "@/components/consultation/workspace/format";

/**
 * "Open amendments (n)" (V2-09b 09B-04a; V2-09a hand-off, T-09A-07): the doctor's own signed visits that were reopened and not finalized yet, each linking
 * to its consult with the date it was opened. Doctor mode only; nothing is shown when there are none. A reopened record stays editable until it is
 * finalized (Finalize with no change is the safe exit), so this is the list to come back to.
 */
export function OpenAmendments({ items, timeZone }: { items: readonly OpenAmendment[]; timeZone: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Open amendments" data-open-amendments="" className="rounded-lg border border-warning-border bg-(--banner-past-due-bg) px-4 py-3">
      <h2 className="mb-1.5 flex items-center gap-2 text-body-sm font-semibold text-(--banner-past-due-fg)">
        <FilePenLine aria-hidden="true" className="size-4" />
        Open amendments ({items.length})
      </h2>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.visitId}>
            <Link href={`/consultation/${item.visitId}`} className="inline-flex min-h-control flex-wrap items-center gap-x-2 text-body-sm font-medium text-fg underline-offset-2 hover:underline focus-visible:focus-ring">
              {item.patientName}
              {item.openedAt && <span className="font-normal text-fg-secondary">opened {clinicDateLabel(item.openedAt, timeZone)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
