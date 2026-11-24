import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/**
 * The skeleton of the Schedule (V2-09e 09E-06, R-9, DESIGN §6.9): the toolbar (date, view switch, doctor) and the day's grid (an hour column and one
 * lane per doctor; one lane at 360 px), in static blocks. Announced once as "Loading"; the page's own `h1` ("Schedule") is screen-reader-only there too.
 */
export function ScheduleSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-3" label="Loading">
      <h1 className="sr-only">Schedule</h1>
      <div data-route-skeleton="schedule" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-36 max-sm:hidden" />
          <Skeleton className="ml-auto h-10 w-28" />
        </div>
        <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 md:grid-cols-[3.5rem_repeat(2,minmax(0,1fr))]">
          <div className="flex flex-col gap-6 pt-8">
            {Array.from({ length: 8 }, (_, hour) => (
              <Skeleton key={hour} shape="text" className="h-3 w-8" />
            ))}
          </div>
          <Skeleton className="h-[34rem] w-full" />
          <Skeleton className="h-[34rem] w-full max-md:hidden" />
        </div>
      </div>
    </SkeletonRegion>
  );
}
