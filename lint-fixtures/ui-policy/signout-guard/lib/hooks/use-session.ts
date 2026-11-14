// Not under features/auth and not the helper: a finding even without "use client".
export function useSignOut(client: { auth: { signOut(): Promise<unknown> } }) {
  return () => client.auth.signOut();
}
