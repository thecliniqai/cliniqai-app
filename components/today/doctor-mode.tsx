"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { useRouter } from "next/navigation";
import type { TodayMode } from "@/features/today/schema";

/**
 * The mode switch of Today (V2-08 08-03b, R-14): an owner who practises toggles between the front desk's day and their own
 * queue ("My queue"). Other roles have one mode and no switch. A mode is a link target (`/today?mode=`), so it survives a
 * refresh and a shared URL.
 */
const LABEL: Record<TodayMode, string> = { front: "Front desk", triage: "Triage", doctor: "My queue" };

export function ModeSwitch({ mode, modes }: { mode: TodayMode; modes: readonly TodayMode[] }) {
  const router = useRouter();
  if (modes.length < 2) return null;
  return (
    <SegmentedControl
      aria-label="Today mode"
      value={mode}
      onValueChange={(value) => router.push(`/today?mode=${value}`)}
      options={modes.map((m) => ({ value: m, label: LABEL[m] }))}
      className="max-md:w-full"
    />
  );
}
