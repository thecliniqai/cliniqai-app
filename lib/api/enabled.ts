/**
 * PO-16 / V2-01 D8: the public REST API (`/api/v1/**`) is off unless `API_V1_ENABLED` is exactly `"true"`, and it is
 * never on in production until P1-37 (the env schema in `lib/env.ts` refuses that combination at boot; this check
 * fails closed at the request edge as well). Edge-safe: no imports.
 */
export function apiV1Enabled(): boolean {
  return process.env.API_V1_ENABLED === "true" && process.env.NODE_ENV !== "production";
}

/** True for `/api/v1` and every path below it. */
export function isApiV1Path(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}
