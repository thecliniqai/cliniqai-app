// 06-09a M-GUARD: a direct call to GoTrue's logout endpoint skips hardSignOut() just as auth.signOut() does.
export async function logoutDirect(url: string, token: string) {
  await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

export async function logoutConcatenated(url: string) {
  await fetch(url + "/auth/v1/logout?scope=global", { method: "POST" });
}
