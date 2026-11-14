import { Zap } from "lucide-react";

/**
 * "Smart Assist" label (AI-02, AI_STRATEGY §5.3; V2-06 06-01b step 6): the mark for rule-based help that is not an
 * LLM (frequent prescriptions, shorthand expansion). Zap glyph, muted text (`smart-fg`); never the Sparkles glyph and
 * never the word "AI", so it cannot be mistaken for an AI feature. Where G2-D chose no label, the surface renders
 * nothing (it does not use this component). Listed with the LLM-feature files in scripts/ci/ai-l1-greps.mjs so a price
 * next to it is still caught by L1-R6.
 */
export function SmartAssistLabel({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-label font-medium text-smart-fg ${className}`}>
      <Zap aria-hidden="true" focusable="false" className="size-3" />
      Smart Assist
    </span>
  );
}
