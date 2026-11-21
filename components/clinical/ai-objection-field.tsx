"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * AiObjectionField (V2-08 08-02, R-12, AI-03; AI_STRATEGY §4.6): the registration checkbox that records a patient's
 * objection to AI-assisted processing of their records, with the interim notice under it. The notice text is interim
 * wording; AI-17 (V2-12) finalises it. Clearing the objection later is an owner or doctor action (migration 000094), so
 * the field only ever sets it. The file is one of the AI-02 labelled files of `scripts/ci/ai-l1-greps.mjs`: it is the
 * only place in the registration form that may say "AI".
 */
export const AI_OBJECTION_LABEL = "Patient objects to AI-assisted features";
export const AI_OBJECTION_NOTICE =
  "Tick this if the patient does not want AI-assisted features, such as note drafting, used with their records. They stay off for this patient. Interim wording.";

export interface AiObjectionFieldProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function AiObjectionField({ checked, onCheckedChange, disabled }: AiObjectionFieldProps) {
  const noticeId = useId();
  return (
    <div className="grid gap-1" data-ai-objection="">
      <Checkbox
        label={AI_OBJECTION_LABEL}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        aria-describedby={noticeId}
      />
      <p id={noticeId} className="text-label text-fg-muted">
        {AI_OBJECTION_NOTICE}
      </p>
    </div>
  );
}
