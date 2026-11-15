import { SIGNED_URL_MAX_TTL_SECONDS } from "./types";

/**
 * Lifetime of every signed storage link to a patient document (V2-06 06-09b; re-verification N-1). Client-safe: no
 * server imports, so the modals that hold a link can check its age. The value is the `view` cap of
 * `SIGNED_URL_MAX_TTL_SECONDS` (`./types`, V2-05 05-10a R-29), the one source of truth; exports are capped at 900 s there.
 *
 * A signed link lives on another origin (Supabase Storage), where the sign-out purge, `Clear-Site-Data` and the
 * sign-out broadcast cannot reach it: a document tab left open on a shared front-desk device can be reloaded, and the
 * URL copied, until the link expires. Five minutes (was one hour for staff links, ten minutes for patient share
 * links) is ample for the browser to load the document, which it does at once; nothing in the app keeps a link for
 * later use without checking {@link isViewLinkFresh} first, and the patient pages' Download buttons go through the
 * token route, which signs a new link on every click.
 */
export const VIEW_LINK_TTL_SECONDS: number = SIGNED_URL_MAX_TTL_SECONDS.view;

/** A held link older than this is renewed before reuse: 30 s short of the expiry, for clock skew and slow opens. */
export const VIEW_LINK_REUSE_MS = (VIEW_LINK_TTL_SECONDS - 30) * 1000;

/** Whether a link signed at `signedAtMs` may still be handed to the browser (false when it may expire in transit). */
export function isViewLinkFresh(signedAtMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - signedAtMs < VIEW_LINK_REUSE_MS;
}
