// AI-L1 fixture (L1-R4): the sparkle icon on deterministic UI must fail the check.
import { Sparkles } from "lucide-react";

export function FastCheckInBadge() {
  return (
    <span>
      <Sparkles className="h-3 w-3" />
      Fast check-in
    </span>
  );
}
