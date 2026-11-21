"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { notify } from "@/components/ui/toast";
import { VitalsForm } from "@/components/clinical/vitals-form";
import { recordVisitVitals } from "@/features/visits/actions";
import { readingToVitalsInput } from "@/features/visits/vitals-input";
import type { VitalsReading } from "@/lib/clinical/vitals";
import type { TodayRow } from "@/features/today/schema";

/**
 * The vitals sheet of a Today row (V2-08 08-03b; replaces the v1 triage modal): `VitalsForm` in a `ResponsiveSheet`. The save
 * is `recordVisitVitals`: the form opens with the readings already on record (A-1) and the server merges what was sent into
 * the stored record, so recording one more reading never drops an earlier one (a repeat only overwrites the same values, so
 * it is not a command with a request id). A refusal keeps the sheet open with the server's fixed message and nothing lost.
 */
export interface VitalsSheetProps {
  row: TodayRow | null;
  onOpenChange: (open: boolean) => void;
  /** The vitals were saved: the board refreshes. */
  onSaved: () => void;
}

function Body({ row, onOpenChange, onSaved }: VitalsSheetProps & { row: TodayRow }) {
  const [error, setError] = useState<string | null>(null);
  const save = async (reading: VitalsReading) => {
    setError(null);
    const result = await recordVisitVitals(row.visitId, readingToVitalsInput(reading));
    if (!result.success) {
      setError(result.error);
      return false;
    }
    notify.success(`Vitals recorded for ${row.name}`);
    onSaved();
    onOpenChange(false);
    return true;
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm text-fg-muted">
        {[row.token != null ? `Token ${row.token}` : null, row.name, row.age, row.sex].filter(Boolean).join(" · ")}
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <VitalsForm onSave={save} initial={row.vitals} />
    </div>
  );
}

export function VitalsSheet(props: VitalsSheetProps) {
  const { row, onOpenChange } = props;
  return (
    <ResponsiveSheet open={row !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-vitals-sheet="" aria-describedby={undefined}>
        <ResponsiveSheetHeader title="Record vitals" />
        <ResponsiveSheetBody>{row && <Body key={row.visitId} {...props} row={row} />}</ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
