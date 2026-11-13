import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env-server";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { isSameOriginRequest } from "@/lib/auth/same-origin";

/**
 * `POST /auth/signout` (V2-03 03-12b; AUTH-04b, PWA D-5, T-03-13). Server-side sign-out: the session is revoked at
 * GoTrue (`signOut({ scope })` on the cookie client, so its refresh token stops working), the auth cookies are
 * deleted through the client's `setAll`, and the browser is told to drop its HTTP cache (`Clear-Site-Data: "cache"`)
 * so no page of the signed-out user is served from it afterwards. 303 → `/login`.
 *
 * - POST only: no GET export, so Next answers any other method 405 (a link or prefetch cannot sign anyone out).
 * - Same-origin only (CSRF, `lib/auth/same-origin.ts`): `Origin` equals the `NEXT_PUBLIC_APP_URL` origin or the
 *   browser says `Sec-Fetch-Site: same-origin`; a browser that says the request is cross-site, or a request with
 *   neither signal, gets 403 and nothing is touched (no client is created).
 * - Form field `scope`: `local` (default, this device) or `global` (every device of the user); anything else 400.
 * - No session: still 303 → `/login` (idempotent).
 *
 * The full PWA "hard sign-out" (cache + IndexedDB wipe, `hardSignOut()`) is V2-06 (PWA-02).
 */

const MODULE = "auth.signout";
const SCOPES = ["local", "global"] as const;
type Scope = (typeof SCOPES)[number];

function appOrigin(): string | null {
  try {
    return new URL(serverEnv().NEXT_PUBLIC_APP_URL).origin;
  } catch {
    // An environment the schema refuses has no trusted origin; only `Sec-Fetch-Site: same-origin` can pass.
    return null;
  }
}

async function readScope(request: NextRequest): Promise<Scope | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded") && !type.startsWith("multipart/form-data")) return "local";
  let value: FormDataEntryValue | null;
  try {
    value = (await request.formData()).get("scope");
  } catch {
    return null;
  }
  if (value === null || value === "") return "local";
  return SCOPES.find((s) => s === value) ?? null;
}

/** Deletes every Supabase auth cookie on this request (used only when GoTrue could not be reached). */
async function dropAuthCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (/^sb-[a-z0-9-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/.test(name)) store.delete(name);
  }
}

function refused(status: 400 | 403): Response {
  return new NextResponse(null, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = await getRequestId();

  if (!isSameOriginRequest(request.headers, appOrigin())) {
    log.warn({ event: "auth.signout.refused", requestId, module: MODULE, reason: "cross_origin", status: 403 });
    return refused(403);
  }

  const scope = await readScope(request);
  if (scope === null) {
    log.warn({ event: "auth.signout.refused", requestId, module: MODULE, reason: "invalid_scope", status: 400 });
    return refused(400);
  }

  const supabase = await createClient();
  let failed = false;
  try {
    const { error } = await supabase.auth.signOut({ scope });
    if (error) {
      failed = true;
      log.warn({ event: "auth.signout.failed", requestId, module: MODULE, code: errorTag(error) });
    }
  } catch (err) {
    failed = true;
    log.warn({ event: "auth.signout.failed", requestId, module: MODULE, code: errorTag(err) });
  }
  // supabase-js keeps the local session when GoTrue answers with anything but 401/403/404 (or cannot be reached);
  // this device is signed out regardless.
  if (failed) await dropAuthCookies();

  log.info({ event: "auth.signout.done", requestId, module: MODULE, reason: scope });
  return new NextResponse(null, {
    status: 303,
    headers: {
      location: "/login",
      "clear-site-data": '"cache"',
      "cache-control": "no-store",
    },
  });
}
