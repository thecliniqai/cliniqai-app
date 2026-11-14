/**
 * Gallery section: AI-02 labels (V2-06 06-02a step 5; AI_STRATEGY §5.3, PO-21; 06-UI-SPEC "AI-L1 copy rules").
 * The 06-01b chips as they render, so the G3 reviewer sees them on their own: "AI Assist" + "Preview" for LLM
 * features, the preview note, "AI features: Coming soon" for plan surfaces, and "Smart Assist" for deterministic
 * ranking. A file in `LLM_FEATURE_FILES` (scripts/ci/ai-l1-greps.mjs) because it writes the word AI; it carries no
 * price or purchase copy, so L1-R6 (no AI within 80 characters of a price) holds here too.
 */
import { AiAssistChip } from "@/components/clinical/ai-assist-chip";
import { AiComingSoonRow } from "@/components/clinical/ai-coming-soon-row";
import { AiPreviewChip, AiPreviewNote } from "@/components/clinical/ai-preview-chip";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

export function AiSection() {
  return (
    <GallerySection
      id="ai"
      title="AI labels"
      intro="Every AI feature is a preview and is labelled; deterministic suggestions say Smart Assist and never AI. No price appears near these labels."
    >
      <GalleryGroup id="ai-llm" title="LLM features">
        <Specimen label="AI Assist + Preview">
          <span className="flex items-center gap-1.5">
            <AiAssistChip />
            <AiPreviewChip />
          </span>
        </Specimen>
        <Specimen label="Preview note" className="max-w-sm">
          <AiPreviewNote />
        </Specimen>
      </GalleryGroup>
      <GalleryGroup id="ai-plan" title="Plan surfaces">
        <Specimen label="Coming soon">
          <AiComingSoonRow />
        </Specimen>
      </GalleryGroup>
      <GalleryGroup id="ai-deterministic" title="Deterministic suggestions">
        <Specimen label="Smart Assist">
          <SmartAssistLabel />
        </Specimen>
      </GalleryGroup>
    </GallerySection>
  );
}
