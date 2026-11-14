import type { MetadataRoute } from "next";
import { PRODUCT_NAME } from "@/lib/design/brand";
import { backgroundColor, themeColor } from "@/lib/design/tokens";

/**
 * Web app manifest (`/manifest.webmanifest`; PWA_STRATEGY §3.1, V2-06 06-05). Static and PHI-free: it is public
 * (`PUBLIC_PAGE_PREFIXES`) because browsers fetch it without credentials and the service worker precaches it.
 *
 * Name: the fixed brand "CliniQ AI" (`PRODUCT_NAME`, 9 characters, within PWA §3.1's 12 for `short_name`). Colours:
 * the approved `#FFFFFF` theme and background from the token mirror (`lib/design/tokens.ts`), never a literal (06-01b).
 * No `orientation` (tablets rotate), no `shortcuts` (P3, R-23 note).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
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
