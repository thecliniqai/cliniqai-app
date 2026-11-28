"use client";

import { useEffect } from "react";
import type { ReferenceCatalogue } from "@/features/reference/catalogues";
import { startReferenceSync } from "@/lib/reference/store";

/**
 * Starts the reference catalogue sync of this document (V2-09e 09E-09, R-5): after first paint, on resume and reconnect, and before the first search. The
 * catalogues are the ones the session's role may read (resolved by the dashboard layout from the permission matrix; the routes and the database check again).
 * Renders nothing; the UI never waits for it.
 */
export function ReferenceSync({ catalogues }: { catalogues: readonly ReferenceCatalogue[] }) {
  const key = catalogues.join(",");
  useEffect(() => startReferenceSync(key === "" ? [] : (key.split(",") as ReferenceCatalogue[])), [key]);
  return null;
}
