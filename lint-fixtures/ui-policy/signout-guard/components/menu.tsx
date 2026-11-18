"use client";
// signout-guard fixture: every call below bypasses hardSignOut() and must be a finding.
import { createClient } from "@/lib/supabase/client";

export async function signOutDirect() {
  await createClient().auth.signOut();
}

export async function signOutAliased() {
  const { auth } = createClient();
  await auth.signOut({ scope: "local" });
}

export async function signOutByElement() {
  const client = createClient();
  await client.auth["signOut"]();
}

export async function signOutDestructured() {
  const { signOut } = createClient().auth;
  await signOut();
}

// Not findings: names that only contain the word, and a comment mentioning auth.signOut().
export function hardSignOutLabel(signOutScope: string) {
  return `hardSignOut ${signOutScope}`;
}
