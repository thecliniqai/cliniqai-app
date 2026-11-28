/**
 * Route loading state (V2-06 06-04b; layout-matching since V2-09e 09E-06, R-9, DESIGN §6.9). Safe here: this segment's redirect and not-found decisions run
 * in the dashboard layout (or this segment's own layout), which renders before this boundary, so a role redirect or a 404 keeps its status code.
 */
import { TodaySkeleton } from "@/components/shell/skeletons/today-skeleton";

export default function Loading() {
  return <TodaySkeleton />;
}
