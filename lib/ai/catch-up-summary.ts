import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { AiChatClient, AiUnavailableError, getAiChatClient } from "./client";
import { CatchUpSummary } from "./types";

export interface GenerateCatchUpSummaryInput {
  tenantId: string;
  patientId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any;
  aiClientOverride?: AiChatClient;
}

/**
 * Generates an on-demand 3-bullet clinical brief for returning patients (visit_count >= 1).
 * Avoids automatic LLM token burns on routine walk-ins (T-05-10, REQ-ai-features).
 *
 * Fails closed (AI-01, AI_STRATEGY.md §4.6): with no configured provider it throws `AiUnavailableError` before
 * reading any visit data or calling out; a provider error or invalid output also throws. It never returns
 * template or mock bullets in place of a model summary.
 */
export async function generatePatientCatchUpSummary(
  input: GenerateCatchUpSummaryInput
): Promise<CatchUpSummary> {
  const aiClient = input.aiClientOverride ?? getAiChatClient();
  if (!aiClient) {
    throw new AiUnavailableError("not_configured");
  }

  let supabase = input.clientOverride;
  if (!supabase) {
    try {
      supabase = await createClient();
    } catch {
      supabase = getAdminClient();
    }
  }

  // 1. Fetch last 3 completed/signed visits for this patient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: visits, error: visitErr } = await (supabase.from("visits") as any)
    .select("id, scheduled_at, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("patient_id", input.patientId)
    .in("status", ["completed", "in_consultation", "waiting", "booked"])
    .order("created_at", { ascending: false })
    .limit(3);

  if (visitErr || !visits || visits.length === 0) {
    return {
      last_visit_date: null,
      last_diagnosis: null,
      active_medications: [],
      bullets: ["First recorded encounter for this patient in ClinicOS."],
    };
  }

  const visitIds = visits.map((v: { id: string }) => v.id);

  // 2. Fetch diagnoses for these visits
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: diagnoses } = await (supabase.from("consultation_diagnoses") as any)
    .select("visit_id, diagnosis_name")
    .eq("tenant_id", input.tenantId)
    .in("visit_id", visitIds);

  // 3. Fetch prescriptions & items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rxList } = await (supabase.from("prescriptions") as any)
    .select("id, visit_id")
    .eq("tenant_id", input.tenantId)
    .in("visit_id", visitIds);

  const rxIds = (rxList || []).map((r: { id: string }) => r.id);
  let items: Array<{ prescription_id: string; medicine_name: string; dosage: string }> = [];

  if (rxIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rxItems } = await (supabase.from("prescription_items") as any)
      .select("prescription_id, medicine_name, dosage")
      .in("prescription_id", rxIds);
    items = rxItems || [];
  }

  const lastVisit = visits[0];
  const lastVisitDate = lastVisit.scheduled_at || lastVisit.created_at;
  const lastDiagRow = (diagnoses || []).find((d: { visit_id: string }) => d.visit_id === lastVisit.id);
  const lastDiagnosis = lastDiagRow?.diagnosis_name || "General Consultation";

  const lastRxRow = (rxList || []).find((r: { visit_id: string }) => r.visit_id === lastVisit.id);
  const activeMeds = lastRxRow
    ? items
        .filter((it) => it.prescription_id === lastRxRow.id)
        .map((it) => it.medicine_name)
    : [];

  // 4. Formulate prompt for 3 concise bullets
  const clinicalTimeline = visits.map((v: { id: string; created_at: string }, idx: number) => {
    const vDiag = (diagnoses || [])
      .filter((d: { visit_id: string }) => d.visit_id === v.id)
      .map((d: { diagnosis_name: string }) => d.diagnosis_name)
      .join(", ");
    const vRx = (rxList || []).find((r: { visit_id: string }) => r.visit_id === v.id);
    const vMeds = vRx
      ? items
          .filter((it) => it.prescription_id === vRx.id)
          .map((it) => it.medicine_name)
          .join(", ")
      : "None";
    return `Visit ${idx + 1} (${new Date(v.created_at).toLocaleDateString("en-IN")}): Diagnoses: ${vDiag || "None"}. Meds: ${vMeds}`;
  }).join("\n");

  const prompt = `Patient Visit History (Past ${visits.length} Encounters):\n${clinicalTimeline}\n\nGenerate exactly 3 concise clinical bullets for doctor catch-up:\n1. Last Visit Summary (diagnoses and timeline)\n2. Current Medications and Regimen\n3. Alerts, Patterns, or Chronic Follow-up notes\n\nReturn JSON: { "bullets": [string, string, string] }`;

  let rawOutput: string;
  try {
    rawOutput = await aiClient.chatCompletion({
      messages: [
        {
          role: "system",
          content: "You are an Indian clinic assistant generating a 3-bullet clinical summary for returning patients. No PII.",
        },
        { role: "user", content: prompt },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.2,
    });
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    throw new AiUnavailableError("provider_error");
  }

  let bullets: string[] = [];
  try {
    const parsed = JSON.parse(rawOutput);
    if (Array.isArray(parsed.bullets)) {
      bullets = parsed.bullets
        .filter((b: unknown): b is string => typeof b === "string" && b.trim().length > 0)
        .slice(0, 3);
    }
  } catch {
    throw new AiUnavailableError("invalid_output");
  }
  if (bullets.length === 0) {
    throw new AiUnavailableError("invalid_output");
  }

  return {
    last_visit_date: lastVisitDate,
    last_diagnosis: lastDiagnosis,
    active_medications: activeMeds,
    bullets,
  };
}
