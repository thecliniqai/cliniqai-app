/**
 * Request ids (V2-03 03-09a, BACKEND H2, T-03-07). `proxy.ts` assigns a fresh UUID to every request it sees, overwrites
 * any inbound `x-request-id` (a caller cannot choose the id its errors are filed under), forwards it to the handler as
 * a request header and echoes it on the response. Server code reads it with {@link getRequestId}.
 */
import { headers } from "next/headers";
import { isUuid } from "./fields";

export const REQUEST_ID_HEADER = "x-request-id";

export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * The current request's id, if it is a UUID; otherwise (no request scope, header missing or malformed) `undefined`.
 */
export async function getRequestId(): Promise<string | undefined> {
  try {
    const value = (await headers()).get(REQUEST_ID_HEADER);
    return isUuid(value) ? value : undefined;
  } catch {
    // `headers()` throws outside a request scope (scripts, unit tests calling a handler directly).
    return undefined;
  }
}
