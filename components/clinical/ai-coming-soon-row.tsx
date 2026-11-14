/**
 * "AI features: Coming soon" (AI-02, AI_STRATEGY §5.3, PO-21; V2-06 06-01b step 6). Muted text only: no price, no
 * button, no upgrade path. SUB-08 (V2-13b) places it on the billing page; until then it is shown in the /dev/ui gallery
 * (06-02a). LLM-feature file in scripts/ci/ai-l1-greps.mjs. Placing it next to a price fails L1-R6 (no exceptions).
 */
export function AiComingSoonRow({ className = "" }: { className?: string }) {
  return (
    <p className={`py-2 text-body-sm text-fg-muted ${className}`}>
      AI features: <span className="font-medium">Coming soon</span>
    </p>
  );
}
