/**
 * "Preview" chip and the preview note (AI-02, AI_STRATEGY §5.3, PO-21; V2-06 06-01b step 6). Every AI feature in
 * v2.0 is a preview: the chip marks it, and the note says it is not sold. LLM-feature file in
 * scripts/ci/ai-l1-greps.mjs; no price copy here or next to it (L1-R6).
 */
export const AI_PREVIEW_NOTE = "AI features are in preview and not yet offered as a paid product.";

export function AiPreviewChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill border border-preview-border bg-preview-bg px-2 py-0.5 text-caption font-semibold text-preview-fg ${className}`}
    >
      Preview
    </span>
  );
}

export function AiPreviewNote({ className = "" }: { className?: string }) {
  return <p className={`text-label text-fg-muted ${className}`}>{AI_PREVIEW_NOTE}</p>;
}
