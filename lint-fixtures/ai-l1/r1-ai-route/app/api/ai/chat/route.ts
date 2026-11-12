// AI-L1 fixture (L1-R1): any file under app/api/ai/ is a reachable AI route and must fail the check.
export async function POST() {
  return new Response(null, { status: 204 });
}
