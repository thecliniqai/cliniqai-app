import "server-only";

// A server-only module on the rule's explicit list: allowed (the server-side password changes sign out here).
export async function endSession(db: { auth: { signOut(o: { scope: string }): Promise<unknown> } }) {
  return db.auth.signOut({ scope: "local" });
}
