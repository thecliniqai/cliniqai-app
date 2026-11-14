/**
 * Cross-tab sign-out signal (V2-06 06-09a M-TABS; PWA_STRATEGY §4 D-5; T-06-03). When one tab or window of the origin
 * signs out, every other open tab must drop what it shows and leave: otherwise the next person at a shared desk finds
 * the previous user's patient record open in another tab, and its client navigations would run under whoever signs
 * in next.
 *
 * - {@link announceSignOut} posts `{ type: "signout", from }` on the `BroadcastChannel` {@link AUTH_CHANNEL} and, for
 *   browsers without it, writes and at once removes the `localStorage` key {@link SIGNAL_KEY} (each change fires a
 *   `storage` event in the other tabs; the key never stays, so the D-3 storage audit never sees it).
 * - {@link onSignOutElsewhere} listens on both and calls the handler at most once per page. A `BroadcastChannel`
 *   message also reaches other channel objects in the SAME document, so each message carries this document's random
 *   `from` value and a document ignores its own: the tab running `hardSignOut()` must finish its own server call and
 *   purge, not jump to `/login` half-way (a `storage` event never reaches the document that made the change).
 *
 * The signal carries no user, account or reason: only "a sign-out happened on this device" and a random per-page value.
 */
export const AUTH_CHANNEL = "clinicos-auth";
export const SIGNAL_KEY = "clinicos.signal.signout";
export const SIGNOUT_TYPE = "signout";
/** Random per document (module state), never stored; tells a page its own message from another tab's. */
const PAGE_ID = Math.random().toString(36).slice(2);

/** The browser objects the signal uses (injected so tests/pwa/auth-broadcast.spec.ts runs it in Node). */
export interface BroadcastTargets {
  channel?: () => Pick<BroadcastChannel, "postMessage" | "close" | "addEventListener" | "removeEventListener">;
  storage?: Pick<Storage, "setItem" | "removeItem">;
  events?: Pick<Window, "addEventListener" | "removeEventListener">;
}

function browserTargets(): BroadcastTargets {
  if (typeof window === "undefined") return {};
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    channel: typeof BroadcastChannel === "function" ? () => new BroadcastChannel(AUTH_CHANNEL) : undefined,
    storage,
    events: window,
  };
}

/** Tells every other tab of this origin that this device signed out. Never throws. */
export function announceSignOut(targets: BroadcastTargets = browserTargets()): void {
  try {
    // Not closed here: the page is about to navigate away, and closing at once could drop the queued message.
    targets.channel?.().postMessage({ type: SIGNOUT_TYPE, from: PAGE_ID });
  } catch {
    // No channel (old Safari, privacy mode): the storage event below still reaches the other tabs.
  }
  try {
    targets.storage?.setItem(SIGNAL_KEY, String(Date.now()));
    targets.storage?.removeItem(SIGNAL_KEY);
  } catch {
    // Storage blocked: the channel above is the only signal.
  }
}

function isOtherPagesSignOut(data: unknown): boolean {
  if (data === null || typeof data !== "object") return false;
  const { type, from } = data as { type?: unknown; from?: unknown };
  return type === SIGNOUT_TYPE && from !== PAGE_ID;
}

/** Calls `handler` once when another tab announces a sign-out; returns the function that stops listening. */
export function onSignOutElsewhere(handler: () => void, targets: BroadcastTargets = browserTargets()): () => void {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    handler();
  };
  let channel: ReturnType<NonNullable<BroadcastTargets["channel"]>> | undefined;
  const onMessage = (event: Event) => {
    if (isOtherPagesSignOut((event as MessageEvent).data)) fire();
  };
  const onStorage = (event: Event) => {
    if ((event as StorageEvent).key === SIGNAL_KEY) fire();
  };
  try {
    channel = targets.channel?.();
    channel?.addEventListener("message", onMessage);
  } catch {
    channel = undefined;
  }
  targets.events?.addEventListener("storage", onStorage);
  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    targets.events?.removeEventListener("storage", onStorage);
  };
}
