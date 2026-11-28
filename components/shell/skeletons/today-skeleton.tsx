import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/**
 * Today's loading skeleton (V2-09e 09E-06, R-9; DESIGN §6.9): the screen's own layout, not the generic page: the date line and the live badge, the filter box
 * and the doctor/mode row, and the lanes (one column at 360 px, two from 768 px, five from 1280 px) each with its head and three rows. Static blocks, the
 * region is announced once as "Loading"; the page's own `h1` ("Today") is screen-reader-only on the real screen and is here too.
 */
export function TodaySkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-3" label="Loading">
      <h1 className="sr-only">Today</h1>
      <div data-route-skeleton="today" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <Skeleton shape="text" className="h-4 w-56 max-w-[60%]" />
          <Skeleton shape="text" className="h-5 w-16" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 min-w-0 flex-[1_1_20rem] md:max-w-[32.5rem]" />
          <Skeleton className="h-10 w-full sm:w-52" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((lane) => (
            <div key={lane} className={`flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 ${lane > 1 ? "max-xl:hidden" : ""}`}>
              <div className="flex items-center gap-2">
                <Skeleton shape="text" className="h-4 w-24" />
                <Skeleton shape="text" className="ml-auto h-4 w-6" />
              </div>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-16 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
