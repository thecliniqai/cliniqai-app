/**
 * Spec 7 harness (PWA_STRATEGY §9.1, V2-08 08-01a): "the response is lost after the commit".
 *
 * Server Actions POST to the page URL with a `Next-Action` header. For a matching POST this lets the request reach the
 * server (`route.fetch()`, so the command commits), then aborts the response the browser was waiting for. The page sees
 * a network failure for a command that did commit; the retry with the same `client_request_id` must replay it.
 *
 * `first` is how many matching requests to cut (a number, or "all" until {@link CommitThenAbort.clear}). Requests after
 * that pass through untouched. `matches` narrows which Server Action POSTs count (default: every one); a spec that must
 * leave the page's other actions alone (a reload after the failure) matches on something only its command sends.
 */
import type { Page, Request } from "@playwright/test";

export interface CommitThenAbortOptions {
  first: number | "all";
  matches?: (request: Request) => boolean;
}

export interface CommitThenAbort {
  /** Matching requests the server received and whose response was then cut. */
  readonly aborted: number;
  /** Stops cutting responses; later requests pass through. Pending cuts finish first. */
  clear(): Promise<void>;
}

export async function commitThenAbort(page: Page, options: CommitThenAbortOptions): Promise<CommitThenAbort> {
  const limit = options.first === "all" ? Number.POSITIVE_INFINITY : options.first;
  const matches = options.matches ?? (() => true);
  let aborted = 0;
  let inFlight: Promise<unknown> = Promise.resolve();
  let active = true;

  const handler = async (route: import("@playwright/test").Route, request: Request) => {
    const isAction = request.method() === "POST" && request.headers()["next-action"] !== undefined;
    if (!active || !isAction || !matches(request) || aborted >= limit) {
      await route.fallback();
      return;
    }
    aborted++;
    const cut = (async () => {
      await route.fetch(); // the server receives the request and commits
      await route.abort("connectionreset"); // the browser never sees the answer
    })();
    inFlight = inFlight.then(() => cut).catch(() => undefined);
    await cut;
  };
  await page.route("**/*", handler);

  return {
    get aborted() {
      return aborted;
    },
    async clear() {
      active = false;
      await inFlight;
      await page.unroute("**/*", handler);
    },
  };
}
