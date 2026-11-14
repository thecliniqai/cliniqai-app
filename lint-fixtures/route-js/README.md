# route-js fixture (V2-06 06-07)

`build/` is a small `.next`-shaped tree for `tests/ci/route-js.spec.ts` and the M0 report's route-JS test. Synthetic
content only (generated word salad, deterministic). Shape copied from a Next 16.4.6 Turbopack build:

- `build/build-manifest.json`: `rootMainFiles` = `root-framework.js`, `root-runtime.js` (the framework root);
  `polyfillFiles` names a file that does not exist on purpose (polyfills are not first-load JS for modern browsers and
  are never read).
- `build/server/app/**/page_client-reference-manifest.js`: the `globalThis.__RSC_MANIFEST[...] = {...}` scripts with
  `entryJSFiles` per entry (root layout, group layout, page). `root-runtime.js` and `layout.js` appear in more than one
  list, so a route that counted a file twice would be too large.
- Routes: `/` (`(dashboard)`), `/login` (`(auth)`), `/consultation/[id]`, and `/_not-found` (excluded by the budgets).

gzip -9 sizes (bytes) asserted by the spec: root-framework 2237, root-runtime 801, layout 898, shared 1135, today 1020,
login 2835, consult 1586, not-found 551. Root = 3038; `/` = 6091; `/login` = 6771; `/consultation/[id]` = 6657.
