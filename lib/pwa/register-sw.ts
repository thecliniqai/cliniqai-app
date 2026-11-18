import { reportClientError } from "@/lib/log/client";

/**
 * Service-worker registration (PWA_STRATEGY §3.7 step 1, §5; V2-06 06-05). Called only by `PwaRuntime` in the
 * authenticated shell, and only when the server layout says `swEnabled` (never under `next dev`, whose chunks are not
 * content-hashed). `updateViaCache: "none"` makes every update check fetch `/sw.js` past the HTTP cache (T-06-05).
 * 06-06 adds `registration.update()` on resume and every 30 min.
 */
export const SW_URL = "/sw.js";
export const SW_OPTIONS: RegistrationOptions = { scope: "/", updateViaCache: "none" };

export async function registerServiceWorker(
  container: Pick<ServiceWorkerContainer, "register"> | undefined = browserContainer(),
): Promise<ServiceWorkerRegistration | null> {
  if (!container) return null;
  try {
    return await container.register(SW_URL, SW_OPTIONS);
  } catch (err) {
    reportClientError("pwa.sw_register_failed", err);
    return null;
  }
}

function browserContainer(): ServiceWorkerContainer | undefined {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
}
