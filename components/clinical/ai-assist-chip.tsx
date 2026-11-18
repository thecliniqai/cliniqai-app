import { Sparkles } from "lucide-react";

/**
 * "AI Assist" chip (AI-02, AI_STRATEGY §5.3; V2-06 06-01b step 6). The one label every LLM feature carries: the
 * Sparkles glyph and the words "AI Assist" on the AI tokens (white chip, Midnight text, control-grey border). It is an
 * LLM-feature file in scripts/ci/ai-l1-greps.mjs (L1-R4/R5 allow the glyph and the word here). It never sits next to a
 * price: L1-R6 has no exceptions, and pricing copy names the plan (PO-21).
 */
export function AiAssistChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill border border-ai-border bg-ai-bg px-2 py-0.5 text-caption font-semibold text-ai-fg ${className}`}
    >
      <Sparkles aria-hidden="true" focusable="false" className="size-3 text-ai-glyph" />
      AI Assist
    </span>
  );
}
