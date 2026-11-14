// The server sign-out route: allowed.
export async function POST(client: { auth: { signOut(o: { scope: string }): Promise<unknown> } }) {
  await client.auth.signOut({ scope: "local" });
  return new Response(null, { status: 303 });
}
