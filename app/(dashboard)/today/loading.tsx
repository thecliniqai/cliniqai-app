/**
 * Route loading state (V2-06 06-04b; the 06-04a skeleton, CD-11). Safe here: this segment's redirect and not-found
 * decisions run in the dashboard layout, which renders before this boundary, so a role redirect keeps its status code.
 */
import { RouteSkeleton } from "@/components/shell/route-skeleton";

export default function Loading() {
  return <RouteSkeleton />;
}
