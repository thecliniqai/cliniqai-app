/**
 * The lifetime Supabase Storage put into a signed object URL (06-09b, re-verification N-1): the `token` query
 * parameter is a JWT whose `exp - iat` is the `expiresIn` the URL was signed with. Read from the URL itself, so a test
 * proves what a browser would get, not what a caller meant to ask for.
 */
export function signedUrlLifetimeSeconds(signedUrl: string): number {
  const url = new URL(signedUrl);
  if (!url.pathname.includes("/storage/v1/object/sign/")) throw new Error("not a signed storage object URL");
  const token = url.searchParams.get("token");
  if (!token) throw new Error("signed URL has no token");
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
    exp?: unknown;
    iat?: unknown;
  };
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") throw new Error("token has no exp/iat");
  return payload.exp - payload.iat;
}
