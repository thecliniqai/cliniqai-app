/**
 * Route loading state (V2-06 06-04b; the 06-04a skeleton, CD-11; V2-09b 09B-02a): a skeleton of the consult's regions, not the generic page skeleton: the top bar,
 * the allergy strip, and the five section rows of the note (a label column beside the body from 768 px). Safe here: this segment's redirect and
 * not-found decisions run in its `layout.tsx` (or the dashboard layout), which renders before this boundary, so a 404 or a role redirect keeps its
 * status code (06-04a deviation 1; `journey-09-clinic-isolation`).
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" aria-busy="true" data-route-skeleton="consult" className="flex w-full flex-1 flex-col bg-canvas">
      <span className="sr-only">Loading</span>
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="ml-auto h-9 w-24" />
      </div>
      <Skeleton className="h-7 w-full rounded-none" />
      <div className="mx-auto flex w-full max-w-note-max flex-col px-4 md:px-6 min-[1180px]:px-8">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="border-b border-border py-4 md:grid md:grid-cols-[var(--label-col)_minmax(0,1fr)] md:max-[1179px]:[--label-col:6rem] md:gap-x-5 min-[1180px]:[--label-col:7.5rem]">
            <div className="mb-3 flex flex-col gap-1.5 md:mb-0">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-14" />
            </div>
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
