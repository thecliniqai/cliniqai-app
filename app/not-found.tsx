/** Root not-found state (V2-06 06-04a): any URL no route matches; outside the dashboard shell. */
import { RouteNotFound } from "@/components/shell/route-not-found";

export default function NotFound() {
  return <RouteNotFound home={{ href: "/", label: "Go to the home page" }} standalone />;
}
