/**
 * Holds Server Action POSTs of a page until the test lets them go (V2-09e 09E-08, R-11): the proof that a reversible save shows its result before the
 * answer and that a confirm-class save shows no success and moves nothing until the database has answered.
 *
 * A held request has NOT reached the server (it is paused in the browser's route handler), so the database cannot have changed either: a spec checks both
 * the screen and the database while it is held. `release()` lets every held request (and every later one) through; `cutAll()` makes every later matching
 * request fail in the browser (a refused or lost save: nothing is committed); `pass()` ends the cutting.
 */
import type { Page, Request } from "@playwright/test";

export interface ActionHold {
  /** Matching action POSTs seen so far (held or not). */
  readonly seen: () => number;
  /** Matching action POSTs currently waiting for `release()`. */
  readonly waiting: () => number;
  /** Lets the held requests and every later one through. */
  release(): void;
  /** Fails every later matching request in the browser without sending it (nothing is committed). */
  cutAll(): void;
  /** Stops cutting: later requests pass. */
  pass(): void;
}

const isAction = (request: Request): boolean => request.method() === "POST" && request.headers()["next-action"] !== undefined;

export async function holdActions(page: Page, options: { matches?: (request: Request) => boolean; held?: boolean } = {}): Promise<ActionHold> {
  const matches = options.matches ?? (() => true);
  let holding = options.held ?? true;
  let cutting = false;
  let seen = 0;
  let waiting = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  await page.route("**/*", async (route, request) => {
    if (!isAction(request) || !matches(request)) {
      await route.fallback();
      return;
    }
    seen += 1;
    if (cutting) {
      await route.abort("failed");
      return;
    }
    if (holding) {
      waiting += 1;
      await gate;
      waiting -= 1;
    }
    await route.fallback();
  });
  return {
    seen: () => seen,
    waiting: () => waiting,
    release() {
      holding = false;
      open();
    },
    cutAll() {
      cutting = true;
    },
    pass() {
      cutting = false;
    },
  };
}

/** Counts the Server Action POSTs `page` sends from now on (a save is one). */
export function countActionPosts(page: Page, matches: (request: Request) => boolean = () => true): () => number {
  let n = 0;
  page.on("request", (request) => {
    if (isAction(request) && matches(request)) n += 1;
  });
  return () => n;
}
