import { streamText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { getAiGatewayModel } from "@/lib/ai/client";
import { getClinicalTools } from "@/lib/ai/tools/clinical-tools";
import { sanitizePatientContextForPrompt } from "@/lib/ai/sanitizer";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let tenantId = user.app_metadata?.tenant_id || "";
    let role = user.app_metadata?.role || "staff";

    try {
      const membership = await getActiveMembership();
      tenantId = membership.tenantId;
      role = membership.role;
    } catch {
      // Fallback
    }

    // RBAC: clinical Q&A allowed for doctor, admin, owner
    const allowedRoles = ["doctor", "admin", "owner"];
    if (!allowedRoles.includes(role.toLowerCase())) {
      return new Response(
        JSON.stringify({
          error: `Forbidden: Role '${role}' is not authorized to access Clinical Copilot.`,
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const patientContext = body?.patientContext;

    // Sanitize patient context before passing into prompt
    const sanitizedPatient = sanitizePatientContextForPrompt(patientContext);
    const prunedMessages = messages.slice(-5);

    const statutoryDisclaimer =
      "\n\n⚠️ Clinical Advisory: CliniQ AI is an informational assistant, not a licensed healthcare professional. All information must be evaluated and verified under independent clinical judgment.";

    const systemPrompt = `You are the CliniQ Clinical Copilot for licensed outpatient physicians.
You assist doctors with diagnostic queries, structuring clinical notes, and providing evidence-based reference information.

PATIENT CONTEXT (De-identified per Indian DPDP Act 2023):
- Age: ${sanitizedPatient.age ?? "Not specified"}
- Sex: ${sanitizedPatient.sex ?? "Not specified"}
- Vitals: ${JSON.stringify(sanitizedPatient.vitals || {})}
- Chronic Conditions: ${(sanitizedPatient.chronic_conditions || []).join(", ") || "None documented"}

CLINICAL SAFETY MANDATES:
1. ZERO AUTONOMOUS PRESCRIBING: Strictly exclude specific drug brand names, dosages, formulations, and durations unless explicitly reviewing notes or requested for generic non-pharmacological advice. All prescription decisions belong strictly to the Registered Medical Practitioner (RMP).
2. NEGATIVE SYLLOGISM RULE: Do NOT fabricate unperformed physical examination findings. If a body system was not explicitly mentioned in the notes or examination shorthand, leave it empty or note that it was not documented.
3. STATUTORY ADVISORY: You must conclude your response with the clinical advisory disclaimer:
"${statutoryDisclaimer}"`;

    const model = getAiGatewayModel();
    const tools = getClinicalTools({
      tenantId,
      userId: user.id,
      role,
      supabase,
    });

    const result = streamText({
      model,
      temperature: 0.1,
      messages: prunedMessages,
      system: systemPrompt,
      tools,
      maxSteps: 3,
    });

    return result.toDataStreamResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("[api/ai/clinical-copilot] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
