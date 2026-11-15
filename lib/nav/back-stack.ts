/**
 * In-app Back (V2-06 06-04b; PWA_STRATEGY §3.2 item 1): the standalone app has no browser Back button on iOS, so the
 * top bar shows one on every non-root screen. It goes back through this tab's own in-app history; when there is none
 * (a fresh standalone launch, a deep link from WhatsApp or a notification) it goes to the screen's nav parent instead
 * of leaving the app. The history is an in-memory list of the paths this document showed (never stored: D-6).
 */
export type BackStack = readonly string[];

/** The stack after the app shows `pathname`: a step back pops, anything else pushes, a repeat changes nothing. */
export function visit(stack: BackStack, pathname: string): BackStack {
  if (stack[stack.length - 1] === pathname) return stack;
  if (stack.length >= 2 && stack[stack.length - 2] === pathname) return stack.slice(0, -1);
  return [...stack, pathname];
}

/** Back uses the browser history only when an earlier in-app screen exists. */
export function canGoBackInApp(stack: BackStack): boolean {
  return stack.length > 1;
}
