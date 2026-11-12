// Inventory-gate fixture (P0-13, V2-02 02-06 AR-M2c): a route handler named route.js. Next serves it; only route.ts
// is inventoried, so it must be flagged. Never imported.
export async function GET() {
  return new Response("fixture");
}
