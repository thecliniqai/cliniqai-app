import "server-only";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

/**
 * V2-09d (request speed): per-request memoisation of the identity and clinic-context lookups (TARGET_ARCHITECTURE §2.4:
 * "resolve the RequestContext once per request"). One request (a page load: layout, page and every nested loader; a
 * Server Action and the render that follows it; a route handler) asks for the session, the membership and the access
 * level many times; each distinct lookup runs once and every caller shares its promise (a failure too: the same
 * request gets the same answer).
 *
 * Why not React `cache()` alone: it memoises only inside a React server render; in a Server Action or a route handler
 * it runs the function every time. The request scope used here is Next's request header store: `headers()` resolves to
 * the same object for every call within one request (layouts, pages, actions and route handlers alike), and to a new
 * one for the next request. Outside a request (a script, a job, a Vitest spec without a Next scope) nothing is memoised.
 *
 * Keys must name everything the answer depends on that can change within one request (the session fingerprint, the
 * active-clinic pin), and {@link forgetRequestMemo} drops the request's entries after an action that changed the
 * context itself (clinic switch, a membership or subscription change), so the render that follows reads it again.
 */
const MEMO = new WeakMap<object, Map<string, Promise<unknown>>>();

async function requestScope(): Promise<object | null> {
  try {
    const scope: unknown = await headers();
    return typeof scope === "object" && scope !== null ? scope : null;
  } catch (err) {
    // Next's own control flow (a static render bailing out to dynamic) is never swallowed; "no request scope" is.
    unstable_rethrow(err);
    return null;
  }
}

export async function requestMemo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const scope = await requestScope();
  if (!scope) return load();
  let entries = MEMO.get(scope);
  if (!entries) {
    entries = new Map();
    MEMO.set(scope, entries);
  }
  const hit = entries.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const pending = load();
  entries.set(key, pending);
  return pending;
}

/** Drops every memoised lookup of this request (no-op outside a request). */
export async function forgetRequestMemo(): Promise<void> {
  const scope = await requestScope();
  if (scope) MEMO.delete(scope);
}

