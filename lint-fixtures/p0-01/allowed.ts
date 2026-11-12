"use server";
// Lint-gate fixture (P0-01): must PASS the P0-01 gates. Target ids are allowed; the acting principal comes from the
// session inside the action; nested callbacks and local variables may use any name.
export async function fixture(
  patientId: string,
  input: { target_tenant_id?: string | null; doctor_id: string; targetTenantId?: string },
  { doctorId, patient_id }: { doctorId: string; patient_id: string } = { doctorId: "", patient_id: "" }
) {
  const session = { userId: "from-session" };
  const client = null;
  const run = (tenantId: string, clientOverride?: unknown) => [tenantId, clientOverride];
  return [patientId, input, doctorId, patient_id, session, client, run];
}
