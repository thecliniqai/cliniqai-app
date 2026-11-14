// 06-09a M-GUARD: no "use client" directive, but imported by a "use client" page, so it runs in the browser. Not on the
// rule's explicit list: a finding (06-05's rule exempted every directive-less file under features/auth/).
export async function abandonReset(client: { auth: { signOut(o: { scope: string }): Promise<unknown> } }) {
  await client.auth.signOut({ scope: "local" });
}
