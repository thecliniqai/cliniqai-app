"use client";

/** Public route error state (V2-06 06-04a): no session here, so nothing is reported; never the error's message. */
import { RouteError } from "@/components/shell/route-error";

export default function PublicRouteError({ error, retry }: { error: unknown; retry: () => void }) {
  return <RouteError error={error} retry={retry} standalone />;
}
