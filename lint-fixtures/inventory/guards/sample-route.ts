// Inventory route-extraction fixture (P0-13, V2-02 02-02): proven by tests/ci/inventory-guards.spec.ts. Never routed.
export async function GET() {
  return new Response(null, { status: 404 });
}

export const PUT = GET;

export const notAMethod = 1;
