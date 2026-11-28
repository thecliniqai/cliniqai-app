// Semgrep fixture (V2-14 14-02).
export async function claim(db: Db, tenantId: string) {
  // ruleid: admin-query-without-tenant
  const all = await db.from("patients").select("id");

  // ok: admin-query-without-tenant
  const mine = await db.from("patients").select("id").eq("tenant_id", tenantId);

  // ok: admin-query-without-tenant
  const longer = await db.from("visits").select("id").eq("status", "done").eq("tenant_id", tenantId).limit(5);

  // ok: admin-query-without-tenant
  const matched = await db.from("visits").select("id").match({ tenant_id: tenantId, status: "done" });
  return { all, mine, longer, matched };
}

export async function byId(db: Db, id: string) {
  // ok: admin-query-without-tenant
  return db.from("visits").select("id, tenant_id").eq("id", id).maybeSingle();
}
