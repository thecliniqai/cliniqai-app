/**
 * V2-04 04-03c (RL-23, P0-12): on the built app, both former cron dispatch routes are gone (04-03a deleted
 * `/api/cron/dispatch-communications`, 04-03b `/api/cron/webhooks`; the job runner at `/api/jobs/run` sends and delivers).
 * Every method answers 404 with or without a bearer: there is no `!==` secret compare left to probe. Unauthenticated;
 * the bearer is a random throwaway value built at run time.
 */
import { randomBytes } from "node:crypto";
import { expect, test } from "../fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

const FORMER_CRON_ROUTES = ["/api/cron/dispatch-communications", "/api/cron/webhooks"];

for (const route of FORMER_CRON_ROUTES) {
  test(`${route}: GET and POST answer 404, with or without a bearer`, async ({ request }) => {
    const bearer = { authorization: `Bearer ${randomBytes(24).toString("hex")}` };
    for (const headers of [{}, bearer]) {
      const get = await request.get(route, { headers, maxRedirects: 0 });
      expect(get.status(), `GET ${route}`).toBe(404);
      const post = await request.post(route, { headers, data: {}, maxRedirects: 0 });
      expect(post.status(), `POST ${route}`).toBe(404);
    }
  });
}
