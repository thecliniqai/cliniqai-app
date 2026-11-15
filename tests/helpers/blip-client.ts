/**
 * V2-06 06-09c: a signed-in anon-key client (like `signInSeededUser`) whose transport can be made to fail for chosen
 * paths, to reproduce a Supabase Auth or PostgREST incident against the local stack (H-AUTHOUT, IND L-2). Requests to
 * other paths, and every request while the mode is `ok`, go to the local stack unchanged. Loopback only (the test
 * lane's guard refuses anything else). Synthetic users only.
 */
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { seededUserPassword } from "./tenants";
import type { TestDb } from "./db";

/** What a failing request answers: an HTTP status with a JSON body, a thrown network error or timeout, or HTML. */
export type BlipMode =
  | "ok"
  | "503"
  | "502"
  | "500"
  | "429"
  | "408"
  | "401"
  | "403"
  | "network"
  | "timeout"
  | "unreadable";

export interface BlipClient {
  client: TestDb;
  setMode: (mode: BlipMode) => void;
  /** Requests answered by the blip (path names only). */
  blipped: string[];
}

function answer(mode: Exclude<BlipMode, "ok">): Response {
  const jsonAnswer = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  switch (mode) {
    case "503":
      return jsonAnswer(503, { message: "Service Unavailable" });
    case "502":
      return new Response("<html><body>Bad Gateway</body></html>", { status: 502, headers: { "content-type": "text/html" } });
    case "500":
      return jsonAnswer(500, { code: "unexpected_failure", message: "Unexpected failure" });
    case "429":
      return jsonAnswer(429, { code: "over_request_rate_limit", message: "Request rate limit reached" });
    case "408":
      return jsonAnswer(408, { message: "Request Timeout" });
    case "401":
      return jsonAnswer(401, { code: "bad_jwt", message: "invalid JWT" });
    case "403":
      return jsonAnswer(403, { code: "session_not_found", message: "Session from session_id claim in JWT does not exist" });
    case "unreadable":
      return new Response("<html><body>upstream</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    case "network":
      throw new TypeError("fetch failed");
    case "timeout":
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }
}

/** Signs `email` in (mode `ok`), then fails the requests whose path starts with one of `paths` while a mode is set. */
export async function blipClient(email: string, paths: readonly string[]): Promise<BlipClient> {
  let mode: BlipMode = "ok";
  const blipped: string[] = [];
  const client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = new URL(href).pathname;
        if (mode !== "ok" && paths.some((p) => path.startsWith(p))) {
          blipped.push(path);
          return answer(mode);
        }
        return fetch(input, init);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: seededUserPassword() });
  if (error) throw new Error(`blip client sign-in failed: ${error.status}`);
  return { client: client as unknown as TestDb, setMode: (m) => (mode = m), blipped };
}
