import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { KBD_BASE, KBD_TONE, type KbdTone } from "@/lib/ui/variants";

/**
 * Kbd (V2-06 06-02a; 06-UI-SPEC Kbd): a shortcut hint, 18 px, caption 11/500 on surface-soft with a hairline and a
 * 1 px inset bottom; `tone="on-accent"` inside a primary button. Hidden below 1024 px and on touch (CD-33), and
 * hidden from assistive technology when it only repeats a shortcut the control already names (`decorative`).
 */
export function Kbd({
  tone = "default",
  decorative = true,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { tone?: KbdTone; decorative?: boolean }) {
  return (
    <kbd aria-hidden={decorative || undefined} className={cn(KBD_BASE, KBD_TONE[tone], className)} {...props} />
  );
}
