import { AllergyBanner } from "@/components/clinical/allergy-banner";

/**
 * The consult's allergy strip (V2-09b R-7, DESIGN_SYSTEM §7.2, CD-14): `AllergyBanner` in all three states (known, none recorded, not recorded),
 * sticky with the rest of the header at every width and on a sealed record too. It is never dismissible and never scrolls away. V2-09c 09C-02 (R-8):
 * while the record is editable and the role may record allergies, "Record now" (not recorded) and "Edit" (known or none) open the allergy editor.
 */
export function AllergyStrip({
  allergies,
  conditions,
  onRecord,
  onEdit,
}: {
  allergies: readonly string[] | null | undefined;
  conditions?: readonly string[];
  onRecord?: () => void;
  onEdit?: () => void;
}) {
  const known = allergies && allergies.length > 0;
  return (
    <div data-allergy-strip="" className="border-b border-border bg-surface">
      <AllergyBanner allergies={allergies} conditions={conditions} onRecord={onRecord} onEdit={onEdit} className={known ? undefined : "px-4 py-1"} />
    </div>
  );
}
