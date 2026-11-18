"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { canGoBackInApp, type BackStack } from "@/lib/nav/back-stack";
import { cn } from "@/lib/utils";

/**
 * In-app Back (06-UI-SPEC §6 TopBar; PWA_STRATEGY §3.2 item 1): "Back" goes one step back through this tab's in-app
 * history (`router.back()`), or to the screen's nav parent when there is none, so a fresh standalone launch or a deep
 * link never leaves the app. The shell shows it on every non-root screen below 1280 px and always in focus mode.
 */
export function BackButton({ getStack, parent, className }: { getStack: () => BackStack; parent: string; className?: string }) {
  const router = useRouter();
  return (
    <IconButton
      label="Back"
      icon={<ArrowLeft />}
      tooltip={false}
      data-back-button=""
      className={cn("-ml-2 shrink-0", className)}
      onClick={() => (canGoBackInApp(getStack()) ? router.back() : router.push(parent))}
    />
  );
}
