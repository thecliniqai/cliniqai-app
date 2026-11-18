"use client";
// 06-09a M-GUARD: spellings 06-05's rule could not see. Every call below must be a finding.
import { createClient } from "@/lib/supabase/client";

declare function pick(): string;

export async function templateName() {
  const { auth } = createClient();
  await auth[`sign${"Out"}`]();
}

export async function concatenatedName() {
  const { auth } = createClient() as unknown as { auth: Record<string, () => Promise<unknown>> };
  await auth["sign" + "Out"]();
}

export async function reflectGet() {
  const auth = createClient().auth;
  await Reflect.get(auth, "signOut").call(auth);
}

export async function unknownKey() {
  const client = createClient() as unknown as { auth: Record<string, () => Promise<unknown>> };
  const key = pick();
  await client.auth[key]();
  await Reflect.get(client.auth, key).call(client.auth);
}

export async function nameInAVariable() {
  const client = createClient() as unknown as Record<string, Record<string, () => Promise<void>>>;
  const method = "signOut";
  await client.supabase[method]();
}

// Not findings: other auth methods by a constant name.
export async function notASignOut() {
  const { auth } = createClient();
  await auth["getSession"]();
  await Reflect.get(auth, "getUser").call(auth);
}
