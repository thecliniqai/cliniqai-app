// Semgrep fixture (V2-14 14-02).
export function gate(token: string) {
  // ruleid: env-gate-node-env-only
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  // ruleid: env-gate-node-env-only
  const skip = process.env.NODE_ENV === "test" ? true : false;
  // ok: env-gate-node-env-only
  if (appEnv() === "production") {
    return skip;
  }
  return token.length > 0;
}
