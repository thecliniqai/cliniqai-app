# V2-04 deferred items (out of plan scope, logged by implementers)

| From | Item | Evidence | Owner proposed |
|---|---|---|---|
| 04-03b | `/settings/developer` full-page axe (WCAG 2.x AA) reports `color-contrast` (serious) on the shared app sidebar's small gray-400 text (role caption, section headings) and on the page header subtitle. Pre-existing v1 styling, not touched by 04-03b; the 04-03b e2e asserts 0 serious/critical on the changed component (`#webhook-subscriptions`) and attaches the full-page result. | `tests/e2e/settings/developer-test-ping.spec.ts` attachments `axe-full-page-*.json`; first e2e run in `04-03b-WEBHOOKS.md` | V2-06 (design system) |
| 04-03b | The webhook subscription table overflows its card at 820 and 1280 px (the Actions column is clipped and scrolls horizontally inside the card) and the 360 px page header overlaps the sticky top bar. Pre-existing v1 layout; 04-03b only keeps its status line inside the visible area. | e2e screenshots at 360/820/1280 | V2-06 |
