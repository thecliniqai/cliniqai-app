// Semgrep fixture (V2-14 14-02).
export async function POST(request: NextRequest) {
  const body = await request.json();
  // ruleid: billing-state-from-request
  await db.rpc("apply_provider_state", { p_state: body.state });
  const event = await verifiedProviderEvent(request.headers);
  // ok: billing-state-from-request
  await db.rpc("apply_provider_state", { p_state: event.state });
}

export async function changePlan(form: FormData) {
  const plan = form.get("plan");
  // ruleid: billing-state-from-request
  await db.rpc("set_subscription_plan", { p_plan: plan });
  // ok: billing-state-from-request
  await db.rpc("get_subscription_summary", { p_plan: plan });
}
