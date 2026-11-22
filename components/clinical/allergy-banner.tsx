import { Check, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/variants";

/**
 * AllergyBanner (V2-06 06-03a; 06-UI-SPEC AllergyBanner, CD-17; DESIGN_SYSTEM §7.2): the patient's safety line.
 *
 * `allergies` carries the three recorded states:
 * - a non-empty list: known allergies. Solid `alert-allergy-bg` (danger-600) with white text, OctagonAlert, 600
 *   weight: "Allergy: Penicillin" / "Allergies: Penicillin, Sulfa". Chronic conditions follow at weight 400 after "·".
 *   Never dismissible; `role="alert"` (only in this state).
 * - `[]`: recorded as none. A neutral chip "No known allergies" with a check.
 * - `null` / `undefined`: not recorded. `alert-unrecorded-*` with TriangleAlert, "Allergies not recorded" and an
 *   optional "Record now" action.
 *
 * `AllergyChip` is the same three states at row size (queue rows, pickers): a 20 px pill, never a live region (a list
 * of rows would announce every patient's allergies at once); the words carry the meaning.
 */
export interface AllergyBannerProps {
  /** Known allergies; `[]` = recorded none; `null`/`undefined` = not recorded. */
  allergies: readonly string[] | null | undefined;
  /** Chronic conditions shown after the allergies ("T2DM", "HTN"). */
  conditions?: readonly string[];
  /** Not recorded: the "Record now" action. */
  onRecord?: () => void;
  /** Known or none: the "Edit" action (V2-09c 09C-02). */
  onEdit?: () => void;
  className?: string;
}

export function allergyText(allergies: readonly string[]): string {
  return `${allergies.length === 1 ? "Allergy" : "Allergies"}: ${allergies.join(", ")}`;
}

const BANNER_ACTION = cn(
  "ml-auto inline-flex min-h-6 cursor-pointer items-center justify-center rounded-sm px-1 font-semibold underline underline-offset-2 touch:min-h-control touch:min-w-control",
  FOCUS_RING,
);

export function AllergyBanner({ allergies, conditions, onRecord, onEdit, className }: AllergyBannerProps) {
  const chronic = conditions && conditions.length > 0 ? conditions.join(", ") : null;

  if (allergies && allergies.length > 0) {
    return (
      <div
        role="alert"
        data-allergy="known"
        className={cn(
          "flex min-h-7 flex-wrap items-center gap-x-2 gap-y-0.5 bg-alert-allergy-bg px-4 py-1 text-body-sm font-semibold text-alert-allergy-fg",
          className,
        )}
      >
        <OctagonAlert aria-hidden="true" className="size-4 shrink-0" />
        <span>{allergyText(allergies)}</span>
        {chronic && (
          <span className="font-normal">
            <span aria-hidden="true">· </span>
            Chronic: {chronic}
          </span>
        )}
        {onEdit && (
          <button type="button" onClick={onEdit} data-allergy-edit="" className={BANNER_ACTION}>
            Edit<span className="sr-only"> allergies</span>
          </button>
        )}
      </div>
    );
  }

  if (allergies) {
    return (
      <div data-allergy="none" className={cn("flex flex-wrap items-center gap-2 text-body-sm text-fg-secondary", className)}>
        <span className="inline-flex h-pill items-center gap-1 rounded-pill bg-surface-muted px-1.75 text-caption font-semibold text-fg-secondary">
          <Check aria-hidden="true" strokeWidth={2.25} className="size-3" />
          No known allergies
        </span>
        {chronic && <span>Chronic: {chronic}</span>}
        {onEdit && (
          <button type="button" onClick={onEdit} data-allergy-edit="" className={cn(BANNER_ACTION, "text-fg-secondary")}>
            Edit<span className="sr-only"> allergies</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-allergy="unrecorded"
      className={cn(
        "flex min-h-7 flex-wrap items-center gap-x-2 gap-y-0.5 bg-alert-unrecorded-bg px-4 py-1 text-body-sm font-medium text-alert-unrecorded-fg",
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      <span>Allergies not recorded</span>
      {chronic && (
        <span className="font-normal">
          <span aria-hidden="true">· </span>
          Chronic: {chronic}
        </span>
      )}
      {onRecord && (
        <button type="button" onClick={onRecord} data-allergy-record="" className={BANNER_ACTION}>
          Record now
        </button>
      )}
    </div>
  );
}

/** Row-size allergy state (queue rows, pickers): "Penicillin" / "No known allergies" / "Allergies not recorded". */
export function AllergyChip({ allergies, className }: { allergies: readonly string[] | null | undefined; className?: string }) {
  const base = "inline-flex h-pill shrink-0 items-center gap-1 rounded-pill px-1.75 text-caption font-semibold whitespace-nowrap";
  if (allergies && allergies.length > 0) {
    return (
      <span data-allergy-chip="known" className={cn(base, "bg-danger-bg text-danger-fg", className)}>
        <OctagonAlert aria-hidden="true" strokeWidth={2} className="size-3" />
        <span className="sr-only">{allergies.length === 1 ? "Allergy: " : "Allergies: "}</span>
        {allergies.join(", ")}
      </span>
    );
  }
  if (allergies) {
    return (
      <span data-allergy-chip="none" className={cn(base, "bg-surface-muted text-fg-secondary", className)}>
        <Check aria-hidden="true" strokeWidth={2.25} className="size-3" />
        No known allergies
      </span>
    );
  }
  return (
    <span
      data-allergy-chip="unrecorded"
      className={cn(base, "border border-warning-fg bg-surface text-warning-fg", className)}
    >
      <TriangleAlert aria-hidden="true" strokeWidth={2} className="size-3" />
      Allergies not recorded
    </span>
  );
}
