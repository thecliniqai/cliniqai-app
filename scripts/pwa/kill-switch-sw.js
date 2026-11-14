/*
 * clinicOS service worker KILL SWITCH (V2-06 06-05; T-06-05; docs/runbooks/pwa.md "Kill switch").
 * Deploy this file, unchanged, as public/sw.js when a deployed worker misbehaves. Browsers fetch /sw.js past the HTTP
 * cache, install it at once, and it deletes every cache, unregisters itself and reloads open windows so they run
 * without a worker. tests/pwa/sw-allowlist.spec.ts runs this file in a node:vm sandbox.
 */
"use strict";
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
    })(),
  );
});
