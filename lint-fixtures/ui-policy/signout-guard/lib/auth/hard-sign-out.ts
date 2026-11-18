// The helper itself: allowed.
export async function signOutLocally(client: { auth: { signOut(o: { scope: string }): Promise<unknown> } }) {
  await client.auth.signOut({ scope: "local" });
}
