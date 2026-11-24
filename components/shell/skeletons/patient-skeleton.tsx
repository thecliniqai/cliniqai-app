import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/**
 * The skeleton of a patient's record (V2-09e 09E-06, R-9, DESIGN §6.9): the identity header (avatar, name and the facts line, the actions), the tab bar and a
 * card of encounters, in static blocks. Announced once as "Loading".
 */
export function PatientSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-6" label="Loading">
      <div data-route-skeleton="patient" className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Skeleton shape="circle" className="size-14 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-7 w-56 max-w-full" />
            <Skeleton shape="text" className="h-3.5 w-72 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="flex gap-6 border-b border-border pb-3">
          {[28, 20, 20, 24].map((w, tab) => (
            <Skeleton key={tab} shape="text" className="h-4" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Skeleton shape="text" className="h-4 w-48" />
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-20 w-full" />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
