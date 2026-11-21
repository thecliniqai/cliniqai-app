import { AllergyBanner } from "@/components/clinical/allergy-banner";

/**
 * The consult's allergy strip (V2-09b R-7, DESIGN_SYSTEM §7.2, CD-14): `AllergyBanner` in all three states (known, none recorded, not recorded),
 * sticky with the rest of the header at every width and on a sealed record too. It is never dismissible and never scrolls away.
 */
export function AllergyStrip({
  allergies,
  conditions,
}: {
  allergies: readonly string[] | null | undefined;
  conditions?: readonly string[];
}) {
  const known = allergies && allergies.length > 0;
  return (
    <div data-allergy-strip="" className="border-b border-border bg-surface">
      <AllergyBanner allergies={allergies} conditions={conditions} className={known ? undefined : "px-4 py-1"} />
    </div>
  );
}
