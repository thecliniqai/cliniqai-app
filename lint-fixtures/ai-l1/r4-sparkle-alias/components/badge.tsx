// AI-L1 fixture (L1-R4): renaming the sparkle icon on import does not hide it.
import { Sparkles as Star } from "lucide-react";

export function QuickTip() {
  return (
    <span>
      <Star className="h-3 w-3" />
      Quick tip
    </span>
  );
}
