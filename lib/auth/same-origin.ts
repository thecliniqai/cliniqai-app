/**
 * V2-03 03-12b (T-03-13, CSRF on sign-out): true only when a browser sent this request from the app's own origin.
 *
 * - A browser that labels the request anything but `same-origin` in `Sec-Fetch-Site` (`cross-site`, `same-site`,
 *   `none`) is refused, whatever `Origin` says.
 * - Otherwise `Origin` equal to the app origin (`NEXT_PUBLIC_APP_URL`) passes, and so does `Sec-Fetch-Site:
 *   same-origin` (a deployment reached on another host name, e.g. a preview URL, is still the same origin to the
 *   browser).
 * - Neither signal (no `Origin`, or `Origin: null`, and no `Sec-Fetch-Site`) is refused: every current browser sends
 *   `Origin` on a form POST, so only a non-browser client lacks both.
 */
export function isSameOriginRequest(headers: Headers, appOrigin: string | null): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  const origin = headers.get("origin");
  if (origin !== null && origin !== "null" && appOrigin !== null && origin === appOrigin) return true;
  return fetchSite === "same-origin";
}
