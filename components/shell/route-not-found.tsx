/**
 * The route not-found state (V2-06 06-04a step 3; P1-28 M3): a heading, plain text and one way back. Static text only
 * (no path, id or query is echoed). `standalone` renders its own `<main>` (the root not-found, outside the shell) and
 * carries the 32 px brand mark, as `/offline` does (06-09e P7).
 *
 * 06-09e (design review M5, P6): the heading is the content title-1 (Manrope 800, 20/26, `tracking-title`), and the
 * way back is a `primary` `lg` button look (44 px), the same size as the error state's "Try again".
 */
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";
import { BUTTON_BASE, BUTTON_INTERACTIVE, BUTTON_SIZE, BUTTON_VARIANT, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";

/** The route-state heading (content title-1, UI-SPEC Typography "Heading 1 (content)"). */
export const ROUTE_STATE_HEADING = "font-display text-title-1 tracking-title text-fg";

export function RouteNotFound({ home, standalone = false }: { home: { href: string; label: string }; standalone?: boolean }) {
  const content = (
    <section aria-labelledby="route-not-found-title" className="mx-auto flex w-full max-w-md flex-col items-start gap-4 py-12">
      {standalone && <BrandMark size={32} />}
      <h1 id="route-not-found-title" className={ROUTE_STATE_HEADING}>
        Page not found
      </h1>
      <p className="text-body text-fg-secondary">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link
        href={home.href}
        className={cn(BUTTON_BASE, TRANSITION, FOCUS_RING, BUTTON_SIZE.lg, BUTTON_VARIANT.primary, BUTTON_INTERACTIVE.primary)}
      >
        {home.label}
      </Link>
    </section>
  );
  if (!standalone) return content;
  return <main className="flex min-h-app w-full items-center justify-center bg-canvas p-4">{content}</main>;
}
