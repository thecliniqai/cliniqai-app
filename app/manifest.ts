import type { MetadataRoute } from "next";
import { backgroundColor, themeColor } from "@/lib/design/tokens";

/**
 * Web app manifest (`/manifest.webmanifest`; PWA_STRATEGY §3.1, V2-06 06-05). Static and PHI-free: it is public
 * (`PUBLIC_PAGE_PREFIXES`) because browsers fetch it without credentials and the service worker precaches it.
 *
 * "ClinicQ" is the Wave A working name; 06-01b replaces the name, colours and icons with the approved CliniQ AI brand.
 * Colours come from the token mirror (`lib/design/tokens.ts`), never a literal. No `orientation` (tablets rotate), no
 * `shortcuts` (P3, R-23 note).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ClinicQ",
    short_name: "ClinicQ",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: backgroundColor,
    theme_color: themeColor,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
