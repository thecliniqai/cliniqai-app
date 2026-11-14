/**
 * The route not-found state (V2-06 06-04a step 3; P1-28 M3): a heading, plain text and one way back. Static text only
 * (no path, id or query is echoed). `standalone` renders its own `<main>` (the root not-found, outside the shell).
 */
import Link from "next/link";

export function RouteNotFound({ home, standalone = false }: { home: { href: string; label: string }; standalone?: boolean }) {
  const content = (
    <section aria-labelledby="route-not-found-title" className="mx-auto flex w-full max-w-md flex-col items-start gap-4 py-12">
      <h1 id="route-not-found-title" className="text-xl font-semibold text-fg">
        Page not found
      </h1>
      <p className="text-sm text-fg-secondary">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link
        href={home.href}
        className="inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 text-sm font-medium text-fg-on-accent hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {home.label}
      </Link>
    </section>
  );
  if (!standalone) return content;
  return <main className="flex min-h-app w-full items-center justify-center bg-canvas p-4">{content}</main>;
}
