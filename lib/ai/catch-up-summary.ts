import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { OpenAiGatewayClient } from "./client";
import { CatchUpSummary } from "./types";

export interface GenerateCatchUpSummaryInput {
  tenantId: string;
  patientId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any;
  aiClientOverride?: OpenAiGatewayClient;
}

/**
 * Generates an on-demand 3-bullet clinical brief for returning patients (visit_count >= 1).
 * Avoids automatic LLM token burns on routine walk-ins (T-05-10, REQ-ai-features).
 */
export async function generatePatientCatchUpSummary(
  input: GenerateCatchUpSummaryInput
): Promise<CatchUpSummary> {
  let supabase = input.clientOverride;
  if (!supabase) {
    try {
      supabase = await createClient();
    } catch {
      supabase = getAdminClient();
    }
  }

  try {
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
    const diffDays = Math.floor(
      (Date.now() - new Date(lastVisitDate).getTime()) / (1000 * 60 * 60 * 24)
    );

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

    const aiClient = input.aiClientOverride || new OpenAiGatewayClient();
    const rawOutput = await aiClient.chatCompletion({
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

    let bullets: string[] = [];
    try {
      const parsed = JSON.parse(rawOutput);
      if (Array.isArray(parsed.bullets) && parsed.bullets.length > 0) {
        bullets = parsed.bullets.slice(0, 3);
      }
    } catch {
      bullets = [
        `Last seen ${diffDays} day(s) ago for ${lastDiagnosis}.`,
        activeMeds.length > 0 ? `Prescribed: ${activeMeds.join(", ")}.` : "No active prescriptions on file.",
        "Follow-up visit. Review clinical progress and vitals.",
      ];
    }

    if (bullets.length === 0) {
      bullets = [
        `Last seen ${diffDays} day(s) ago for ${lastDiagnosis}.`,
        activeMeds.length > 0 ? `Prescribed: ${activeMeds.join(", ")}.` : "No active medications recorded.",
        "Routine return visit.",
      ];
    }

    return {
      last_visit_date: lastVisitDate,
      last_diagnosis: lastDiagnosis,
      active_medications: activeMeds,
      bullets,
    };
  } catch (err) {
    console.error("[generatePatientCatchUpSummary] Exception:", err);
    return {
      last_visit_date: null,
      last_diagnosis: null,
      active_medications: [],
      bullets: ["Returning patient encounter. Clinical history available in past visits tab."],
    };
  }
}
