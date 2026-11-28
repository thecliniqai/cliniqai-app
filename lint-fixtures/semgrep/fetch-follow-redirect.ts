// Semgrep fixture (V2-14 14-02).
export async function deliver(url: string, body: string) {
  // ruleid: fetch-follow-redirect
  await fetch(url, { method: "POST", body });
  // ruleid: fetch-follow-redirect
  await fetch(url);
  // ok: fetch-follow-redirect
  await fetch(url, { method: "POST", body, redirect: "manual" });
}
