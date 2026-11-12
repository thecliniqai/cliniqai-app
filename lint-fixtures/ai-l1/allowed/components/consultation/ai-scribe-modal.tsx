// AI-L1 fixture (allowed): an LLM-feature file may carry the AI label, the sparkle icon and the ✦ glyph.
import { Sparkles } from "lucide-react";

export function ScribeHeader() {
  return (
    <h2>
      <Sparkles className="h-4 w-4" />
      AI Clinical Scribe
      <span>✦ AI Suggested Draft</span>
    </h2>
  );
}
