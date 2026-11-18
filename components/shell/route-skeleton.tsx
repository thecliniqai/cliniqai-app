/**
 * The route loading state (V2-06 06-04a step 3; P1-28 M3): what `loading.tsx` shows while a segment's server
 * response is on its way. A `status` region named "Loading" (announced once, not per bar); the bars are decorative and
 * only pulse when the user allows motion. `standalone` renders its own `<main>` (outside the dashboard shell).
 */
export function RouteSkeleton({ standalone = false }: { standalone?: boolean }) {
  const bars = (
    <div role="status" aria-label="Loading" aria-busy="true" className="w-full space-y-4">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="h-8 w-48 max-w-full rounded-lg bg-border motion-safe:animate-pulse" />
      <div aria-hidden="true" className="h-4 w-full max-w-xl rounded bg-border motion-safe:animate-pulse" />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-28 rounded-xl bg-border motion-safe:animate-pulse" />
        <div className="h-28 rounded-xl bg-border motion-safe:animate-pulse" />
        <div className="hidden h-28 rounded-xl bg-border motion-safe:animate-pulse lg:block" />
      </div>
      <div aria-hidden="true" className="h-64 w-full rounded-xl bg-border motion-safe:animate-pulse" />
    </div>
  );
  if (!standalone) return bars;
  return <main className="mx-auto flex min-h-app w-full max-w-3xl items-start bg-canvas p-4 sm:p-8">{bars}</main>;
}
