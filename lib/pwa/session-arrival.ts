import { announceSignOut } from "@/lib/pwa/auth-broadcast";
import { purgeDeviceState } from "@/lib/pwa/purge";

/**
 * Device purge for sessions the SERVER ended (V2-06 06-09a: IND L-6, A Info I-1). `hardSignOut()` purges every exit a
 * user starts, but some sessions end without it: the proxy's H-AUTH revocation of a mailbox-code session, the global
 * sign-out after a password reset, and signing in on `/login` over a live session (user B's cookies replace user A's).
 * The login page calls these:
 *
 * - {@link onLoginArrival}: with no session cookie left, the session has ended, so the device is purged and every other
 *   tab is told to leave (they share the cookie jar, so they are signed out too). A signed-in user who merely opens
 *   `/login` is left alone.
 * - {@link afterSignIn}: when the sign-in replaced a live session, the previous user's other tabs are told to leave
 *   (they would otherwise run under the new user's cookies) and the device is purged.
 *
 * Purging is idempotent: after `hardSignOut()` the login page purges an already clean device.
 */
/** A Supabase session cookie (whole or chunked); the PKCE verifier alone is not a session. */
const SESSION_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/;

export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader.split(";").some((pair) => {
    const [name, ...rest] = pair.split("=");
    return SESSION_COOKIE.test(name?.trim() ?? "") && rest.join("=").trim() !== "";
  });
}

export interface ArrivalDeps {
  cookies: () => string;
  announce: () => void;
  purge: () => Promise<unknown>;
}

function browserDeps(): ArrivalDeps {
  return { cookies: () => document.cookie, announce: () => announceSignOut(), purge: () => purgeDeviceState() };
}

/** On arrival at `/login`: purge and tell the other tabs when no session is left. Returns whether it purged. */
export async function onLoginArrival(deps: ArrivalDeps = browserDeps()): Promise<boolean> {
  if (hasSessionCookie(deps.cookies())) return false;
  deps.announce();
  try {
    await deps.purge();
  } catch {
    // purgeDeviceState never throws; a stand-in might. The next exit purges again.
  }
  return true;
}

/** After a successful sign-in: when it replaced a live session, the old user's tabs leave and the device is purged. */
export async function afterSignIn(replacedSession: boolean, deps: ArrivalDeps = browserDeps()): Promise<void> {
  if (!replacedSession) return;
  deps.announce();
  try {
    await deps.purge();
  } catch {
    // As above.
  }
}
