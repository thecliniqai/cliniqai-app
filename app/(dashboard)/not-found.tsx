/** Dashboard not-found state (V2-06 06-04a): inside the shell, for `notFound()` in a dashboard page. */
import { RouteNotFound } from "@/components/shell/route-not-found";

export default function DashboardNotFound() {
  return <RouteNotFound home={{ href: "/", label: "Go to Today" }} />;
}
