import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/**
 * The skeleton of a list or register page (Patients, Visits, Staff, Billing reports, Referrals; V2-09e 09E-06, R-9, DESIGN §6.9): the page's real title at once,
 * then the toolbar and a table of rows in static blocks. Announced once as "Loading".
 */
export function ListSkeleton({ title, rows = 8 }: { title: string; rows?: number }) {
  return (
    <SkeletonRegion className="flex flex-col gap-5" label="Loading">
      <div data-route-skeleton="list" className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{title}</h1>
            <Skeleton shape="text" className="mt-2 h-3.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-10 w-full sm:w-40" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 min-w-0 flex-[1_1_16rem] sm:max-w-sm" />
          <Skeleton className="h-10 w-28" />
        </div>
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex items-center gap-3 px-4 py-3">
              <Skeleton shape="circle" className="size-8 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton shape="text" className="h-3.5 w-40 max-w-full" />
                <Skeleton shape="text" className="h-3 w-24 max-w-[60%]" />
              </div>
              <Skeleton shape="text" className="h-3.5 w-16 max-sm:hidden" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
