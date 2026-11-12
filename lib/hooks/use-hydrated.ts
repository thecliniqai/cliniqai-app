"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` during server render and the first hydration pass, `true` once React owns the page.
 *
 * Credential forms disable their submit button until hydrated so a click that lands before hydration
 * cannot fall through to a native form submission (which, without a JS handler, would send the
 * fields to the server and, for a GET form, into the URL). The forms also declare `method="post"`
 * as a second line of defence.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
