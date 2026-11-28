"use client";

import { useEffect } from "react";
import { rum } from "@/lib/observability/rum/collector";

/**
 * The first-data marker of a main screen (V2-09e 09E-02, R-20). A screen renders it where its first real data is on screen (never in a
 * skeleton). When it mounts it records the screen's `nav_data_ready` (the click on an in-app link until now) or, for a full load, its
 * `load_data_ready` (navigation start until now), and leaves a `clinicos.data_ready` performance mark that the staging smoke script
 * reads. Renders nothing.
 */
export function DataReady() {
  useEffect(() => {
    try {
      performance.mark("clinicos.data_ready");
    } catch {
      // no Performance API: the RUM sample below still goes
    }
    rum.dataReady();
  }, []);
  return null;
}
