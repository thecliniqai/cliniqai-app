// A server module under features/auth: allowed (the server-side sign-outs live here).
export async function endSession(db: { auth: { signOut(o: { scope: string }): Promise<unknown> } }) {
  return db.auth.signOut({ scope: "local" });
}
