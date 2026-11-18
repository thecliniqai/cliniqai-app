"use client";

/**
 * Onboarding route error state (V2-06 06-04a). Does not report: the report action is membership-only and a user on
 * onboarding has no clinic membership yet, so every report would be refused.
 */
import { RouteError } from "@/components/shell/route-error";

export default function OnboardingError({ error, retry }: { error: unknown; retry: () => void }) {
  return <RouteError error={error} retry={retry} standalone />;
}
