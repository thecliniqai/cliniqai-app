/**
 * V2-14 14-01 (P1-18; plan D-4): the per-request security headers of an app page, set by `proxy.ts`.
 *
 * Content-Security-Policy: a fresh nonce per request with `'strict-dynamic'` (Next.js reads the nonce from the request's
 * CSP header and puts it on its own scripts; a script those load is trusted in turn, e.g. Turnstile's). No
 * `'unsafe-inline'` and no `'unsafe-eval'` for scripts outside `next dev`. Styles keep `'unsafe-inline'`: React writes
 * server-rendered `style` attributes, which a nonce cannot cover (14-NOTES D-14a-2). The Supabase origin is allowed for
 * REST/Auth (https) and Realtime (wss), its signed Storage URLs for images and the PDF iframes; Razorpay only on the
 * billing pages; Turnstile's frame host on every page (sign-in, join and reset use it). `worker-src`/`manifest-src`
 * `'self'` keep the PWA (the service worker and the medicine-search worker are same-origin scripts). `frame-ancestors
 * 'none'`: no page is framed (the receipt iframe loads an `/api` PDF, which carries no page CSP).
 *
 * Pure and dependency-free (the proxy imports it); tests/security/csp-headers.spec.ts.
 */

/** Request header carrying this request's nonce to the app (Next.js itself reads the CSP header). */
export const NONCE_HEADER = "x-nonce";
export const CSP_HEADER = "content-security-policy";

/** Pages that open the Razorpay checkout (subscriptions, SUBSCRIPTIONS_AND_PLANS; plan D-4). */
export const BILLING_PAGE_PREFIXES = ["/onboarding/billing", "/settings/billing", "/billing/locked"] as const;
const RAZORPAY_SCRIPT = "https://checkout.razorpay.com";
const RAZORPAY_FRAME = "https://api.razorpay.com";
const RAZORPAY_CONNECT = ["https://api.razorpay.com", "https://lumberjack.razorpay.com"] as const;
const TURNSTILE = "https://challenges.cloudflare.com";

/**
 * Pages whose URL carries a token or names a patient, or that start onboarding: `Referrer-Policy: no-referrer`, so not
 * even the origin is sent when a link leaves the app. Token pages (`/r/`, `/reschedule/`, `/join`, `/reports/view`) are
 * also never stored by a cache.
 */
const NO_REFERRER_PREFIXES = [
  "/r/",
  "/reschedule/",
  "/join",
  "/reports/view",
  "/patients",
  "/consultation/",
  "/visits",
  "/onboarding",
  "/clinic/new",
  "/forgot-password",
  "/auth/",
] as const;
const TOKEN_PAGE_PREFIXES = ["/r/", "/reschedule/", "/join", "/reports/view"] as const;
/** The report upload's `<input capture>` pages (09B-06a): the only pages that may use the camera. */
const CAMERA_PAGE_PREFIXES = ["/consultation/", "/patients/"] as const;

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

export function isBillingPage(pathname: string): boolean {
  return matchesPrefix(pathname, BILLING_PAGE_PREFIXES);
}

/**
 * True for a request the page headers apply to: everything the proxy sees except `/api` (route handlers: JSON, PDFs,
 * the RUM beacon; their own headers) and `/sw.js` (its own script CSP in next.config.ts). Case-folded, so `/API/x` and
 * `/SW.JS` (Next routes are case-sensitive: those are 404 pages) are judged like the routes they spell.
 */
export function isPagePath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  if (lower === "/api" || lower.startsWith("/api/")) return false;
  if (lower === "/sw.js") return false;
  return true;
}

/** 128 random bits, base64. Web Crypto (available to the proxy in every runtime). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** `https://x.supabase.co` → itself and `wss://x.supabase.co`; loopback `http` → `ws`. Invalid → none (fail closed). */
function supabaseSources(supabaseUrl: string): { http: string[]; ws: string[] } {
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return { http: [], ws: [] };
    const ws = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
    return { http: [url.origin], ws: [ws] };
  } catch {
    return { http: [], ws: [] };
  }
}

export interface PolicyInput {
  nonce: string;
  pathname: string;
  supabaseUrl: string;
  /** `next dev` only: React's dev tooling needs eval. Never true for a `next build`. */
  dev?: boolean;
}

export function contentSecurityPolicy({ nonce, pathname, supabaseUrl, dev = false }: PolicyInput): string {
  const supabase = supabaseSources(supabaseUrl);
  const billing = isBillingPage(pathname);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(billing ? [RAZORPAY_SCRIPT] : []), ...(dev ? ["'unsafe-eval'"] : [])],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...supabase.http]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...supabase.http, ...supabase.ws, ...(billing ? RAZORPAY_CONNECT : [])]],
    ["frame-src", ["'self'", "blob:", ...supabase.http, TURNSTILE, ...(billing ? [RAZORPAY_FRAME] : [])]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/**
 * Every security header of a page response (lower-case names). `Strict-Transport-Security` and
 * `X-Content-Type-Options` are static and set for every path in next.config.ts.
 */
export function pageSecurityHeaders(input: PolicyInput): Record<string, string> {
  const { pathname } = input;
  const headers: Record<string, string> = {
    [CSP_HEADER]: contentSecurityPolicy(input),
    "referrer-policy": matchesPrefix(pathname, NO_REFERRER_PREFIXES) ? "no-referrer" : "strict-origin-when-cross-origin",
    "permissions-policy": [
      `camera=${matchesPrefix(pathname, CAMERA_PAGE_PREFIXES) ? "(self)" : "()"}`,
      "microphone=()",
      "geolocation=()",
      `payment=${isBillingPage(pathname) ? `(self "${RAZORPAY_FRAME}")` : "()"}`,
      "usb=()",
    ].join(", "),
    // Razorpay's checkout opens bank and UPI pages in popups that report back to the opener.
    "cross-origin-opener-policy": isBillingPage(pathname) ? "same-origin-allow-popups" : "same-origin",
    "x-frame-options": "DENY",
  };
  if (matchesPrefix(pathname, TOKEN_PAGE_PREFIXES)) {
    headers["cache-control"] = "private, no-cache, no-store, must-revalidate, max-age=0";
  }
  return headers;
}
