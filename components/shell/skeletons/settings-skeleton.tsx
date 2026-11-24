import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/**
 * The skeleton of a settings or profile page (V2-09e 09E-06, R-9, DESIGN §6.9): the real title at once, then a card of labelled fields in static blocks.
 * Announced once as "Loading".
 */
export function SettingsSkeleton({ title, fields = 6 }: { title: string; fields?: number }) {
  return (
    <SkeletonRegion className="flex max-w-3xl flex-col gap-6" label="Loading">
      <div data-route-skeleton="settings" className="flex flex-col gap-6">
        <div className="border-b border-border pb-2">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
          <Skeleton shape="text" className="mt-2 h-3.5 w-80 max-w-full" />
        </div>
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4 sm:p-6">
          {Array.from({ length: fields }, (_, field) => (
            <div key={field} className="flex flex-col gap-2">
              <Skeleton shape="text" className="h-3.5 w-28" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </SkeletonRegion>
  );
}
