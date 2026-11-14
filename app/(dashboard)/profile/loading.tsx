/**
 * Route loading state (V2-06 06-04a): the skeleton inside the dashboard shell. Only on segments whose pages never call
 * `notFound()` or `redirect()`: a loading boundary starts the streamed response with HTTP 200, so above such a page it
 * would turn a 404/307 into a streamed 200 (06-04a record, deviation 1).
 */
import { RouteSkeleton } from "@/components/shell/route-skeleton";

export default function Loading() {
  return <RouteSkeleton />;
}
