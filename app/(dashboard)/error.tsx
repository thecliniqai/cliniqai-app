"use client";

/** Dashboard route error state (V2-06 06-04a): inside the shell; reports uncaught render errors (R-3). */
import { RouteError } from "@/components/shell/route-error";

export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  return <RouteError error={error} retry={retry} report home={{ href: "/", label: "Go to Today" }} />;
}
