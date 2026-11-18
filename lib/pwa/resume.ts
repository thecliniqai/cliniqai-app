import { LIVE_VIEWS } from "@/lib/nav/nav-for-role";

/**
 * Refresh on resume (V2-06 06-04b; PWA_STRATEGY §3.2 item 2, 06-UI-SPEC §6 "Resume and refresh"): a live view (Today
 * `/`, `/queue`, `/calendar`, `/cabin`) re-fetches its server data (`router.refresh()`, one RSC request) when the app
 * comes back to the foreground (`visibilitychange` → visible) and when the network returns (`online`). A tablet left on
 * the front desk overnight shows today's queue, not yesterday's, as soon as it is looked at.
 *
 * One refresh per resume: a reconnect often fires `online` and `visibilitychange` together, so a second trigger within
 * {@link RESUME_COALESCE_MS} of the last refresh is dropped. Other screens (a form, the consult) are never refreshed
 * underneath the user. Nothing is cached or stored; the server answer replaces what is on screen.
 */
export const RESUME_COALESCE_MS = 2_000;

export function isLiveView(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return LIVE_VIEWS.includes(path);
}

export interface ResumeDeps {
  pathname: () => string;
  refresh: () => void;
  isVisible: () => boolean;
  /** Subscribes to `visibilitychange` and `online`; returns the unsubscribe. */
  listen: (onVisibility: () => void, onOnline: () => void) => () => void;
  now: () => number;
}

/** Starts the resume refresh; returns the stop function. */
export function startResumeRefresh(deps: ResumeDeps): () => void {
  let last = Number.NEGATIVE_INFINITY;
  const trigger = () => {
    if (!deps.isVisible() || !isLiveView(deps.pathname())) return;
    const now = deps.now();
    if (now - last < RESUME_COALESCE_MS) return;
    last = now;
    deps.refresh();
  };
  return deps.listen(trigger, trigger);
}

/** The browser wiring for {@link startResumeRefresh}. */
export function browserResumeListen(onVisibility: () => void, onOnline: () => void): () => void {
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
  };
}
