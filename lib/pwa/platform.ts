/**
 * Platform detection for the install UX (V2-06 06-06; PWA_STRATEGY §6.2, §6.3). Pure: every input is passed in, so
 * `tests/pwa/platform.spec.ts` runs a user-agent table in Node.
 *
 * - iOS: `iPhone` or `iPod` in the UA. iPadOS Safari reports a Mac UA, so an iPad is `Macintosh` with
 *   `maxTouchPoints > 1` (a Mac has 0). An `iPad` UA (older iPadOS, Playwright's iPad descriptors) counts as iPadOS too.
 * - In-app browsers (WhatsApp, Gmail's `GSA`, Facebook `FBAN/FBAV`, Instagram, Android WebView `; wv)`) cannot install
 *   a PWA: the user is sent to Chrome (Android) or told to open Safari (iOS).
 * - Installed: `navigator.standalone === true` (iOS) or `display-mode: standalone`.
 */
export function isIos(ua: string): boolean {
  return /iPhone|iPod/.test(ua);
}

export function isIpadOs(ua: string, maxTouchPoints: number): boolean {
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function isAppleMobile(ua: string, maxTouchPoints: number): boolean {
  return isIos(ua) || isIpadOs(ua, maxTouchPoints);
}

export function isAndroid(ua: string): boolean {
  return /Android/.test(ua);
}

export function isInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|Instagram|WhatsApp|GSA|; wv\)/.test(ua);
}

export function isStandalone(
  nav: { standalone?: boolean } | undefined = typeof navigator === "undefined" ? undefined : (navigator as { standalone?: boolean }),
  matchMedia: ((query: string) => { matches: boolean }) | undefined = typeof window === "undefined" ? undefined : window.matchMedia?.bind(window),
): boolean {
  if (nav?.standalone === true) return true;
  try {
    return matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

/**
 * Android's "open this page in Chrome" link: `intent://<host><path>#Intent;scheme=https;package=com.android.chrome;end`,
 * built from the current location's host and path only (no query or fragment: they could carry a token).
 */
export function chromeIntentUrl(location: { host: string; pathname: string }): string {
  const host = location.host.replace(/[^A-Za-z0-9.:-]/g, "");
  const path = location.pathname.startsWith("/") ? location.pathname : `/${location.pathname}`;
  const safePath = path.split("/").map((segment) => encodeURIComponent(decodeSafe(segment))).join("/");
  return `intent://${host}${safePath}#Intent;scheme=https;package=com.android.chrome;end`;
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** What the "Install app" entry does on this device. */
export type InstallMode =
  /** Chromium captured `beforeinstallprompt`: the entry shows the browser's install prompt. */
  | "prompt"
  /** iOS / iPadOS Safari: the entry opens the three-step "Add to Home Screen" sheet. */
  | "ios-sheet"
  /** An Android in-app browser: the entry opens the page in Chrome. */
  | "open-in-chrome"
  /** An iOS in-app browser: the entry explains how to open the page in Safari. */
  | "open-in-safari"
  /** Installed, standalone, or a browser that cannot install from here: no entry. */
  | "none";

export interface InstallContext {
  ua: string;
  maxTouchPoints: number;
  standalone: boolean;
  /** A `beforeinstallprompt` event is held. */
  canPrompt: boolean;
  /** `appinstalled` fired in this page. */
  installed: boolean;
}

export function installMode(ctx: InstallContext): InstallMode {
  if (ctx.standalone || ctx.installed) return "none";
  const apple = isAppleMobile(ctx.ua, ctx.maxTouchPoints);
  if (isInAppBrowser(ctx.ua)) return apple ? "open-in-safari" : isAndroid(ctx.ua) ? "open-in-chrome" : "none";
  if (apple) return "ios-sheet";
  return ctx.canPrompt ? "prompt" : "none";
}
