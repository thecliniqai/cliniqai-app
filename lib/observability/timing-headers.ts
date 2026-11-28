/**
 * Request headers `proxy.ts` forwards to the handler for the timing line (V2-09e 09E-02, R-20). Both are the proxy's alone:
 * it overwrites any inbound value, and the reader validates them again (a route pattern from the generated list, a start time
 * that is a plausible recent instant), so a caller can never choose what a line says.
 */
export const ROUTE_HEADER = "x-clinicos-route";
export const START_HEADER = "x-clinicos-t0";
/** A start time older than this is ignored (the request started when the handler first looked). */
export const MAX_REQUEST_AGE_MS = 120_000;
