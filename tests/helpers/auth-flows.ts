/**
 * Shared helpers for the auth DB-lane specs (03-12a): a browser-like supabase-js client (PKCE, in-memory storage),
 * Mailpit lookups and recovery-code requests. Codes and passwords are returned to the spec, never printed.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/db/types";
import { requestReset, signIn } from "@/features/auth/password-flows";
import { LOCAL_MAILPIT_API_URL } from "../setup/test-env";

export function browserLikeClient() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const client = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage },
  });
  return { client, store };
}

export type BrowserLikeClient = ReturnType<typeof browserLikeClient>["client"];

export function syntheticPassword(): string {
  return `N-${randomBytes(15).toString("base64url")}`;
}

/** A client signed in with `email` / `password`, or a failure result. */
export async function signedInClient(email: string, password: string) {
  const { client } = browserLikeClient();
  const result = await signIn(client, { email, password });
  return { client, result };
}

export async function canSignIn(email: string, password: string): Promise<boolean> {
  return (await signedInClient(email, password)).result.ok;
}

interface MailpitSummary {
  ID: string;
}

async function mailFor(address: string): Promise<MailpitSummary[]> {
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed (HTTP ${res.status})`);
  return ((await res.json()) as { messages?: MailpitSummary[] }).messages ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Requests a reset code for `email` through the browser flow and returns it from Mailpit (never printed). */
export async function requestRecoveryCode(email: string, timeoutMs = 10_000): Promise<string> {
  const before = (await mailFor(email)).length;
  const { client } = browserLikeClient();
  const requested = await requestReset(client, { email });
  if (!requested.ok) throw new Error(`reset request refused (${requested.code})`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await mailFor(email);
    if (messages.length > before) {
      const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/message/${messages[0].ID}`);
      const text = ((await res.json()) as { Text?: string }).Text ?? "";
      const code = /\b(\d{8})\b/.exec(text)?.[1];
      if (!code) throw new Error("the reset email carried no 8-digit code (R-36)");
      return code;
    }
    await sleep(250);
  }
  throw new Error("No reset email arrived in Mailpit in time");
}

/** A browser-like client holding a fresh recovery session for `email` (code requested and verified, type recovery). */
export async function recoverySession(email: string): Promise<BrowserLikeClient> {
  const code = await requestRecoveryCode(email);
  const { client } = browserLikeClient();
  const { data, error } = await client.auth.verifyOtp({ email, token: code, type: "recovery" });
  if (error || !data.session) throw new Error(`verifyOtp(recovery) failed (${error?.code ?? "no session"})`);
  return client;
}

/** True when `client`'s refresh token was revoked (its session was signed out elsewhere). */
export async function refreshRevoked(client: BrowserLikeClient): Promise<boolean> {
  const { error } = await client.auth.refreshSession();
  return error?.code === "refresh_token_not_found";
}
