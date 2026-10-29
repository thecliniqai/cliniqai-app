import { streamText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { getAiGatewayModel } from "@/lib/ai/client";
import { getOperationsTools } from "@/lib/ai/tools/operations-tools";

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
      // Fall back to app_metadata if active membership derivation not available
    }

    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const screenContext = body?.screenContext;

    // Sliding-window pruning: keep last 5 turns
    const prunedMessages = messages.slice(-5);

    const todayStr = new Date().toISOString().slice(0, 10);
    const systemPrompt = `You are the ClinicOS Global Operations Copilot for clinic staff.
Current Route Context: ${screenContext?.screen || "Dashboard"} | Staff Role: ${role} | Today's Date: ${todayStr}.
You assist clinic staff with searching patients, checking doctor schedule/availability, staging appointment bookings, rescheduling, cancellations, and checking queue status.

CRITICAL RULES FOR APPOINTMENT BOOKING:
1. Patient Identification: You must identify the patient. If the user provides a name or phone number, call 'search_patients' to get the verified patient_id and full_name. If no patient exists or multiple matches exist, ask for clarification or offer quick registration.
2. Doctor Selection: An appointment REQUIRES a specific practicing doctor. If the user has NOT specified which doctor, you MUST call 'list_doctors' and ask the staff which doctor they want to book with. NEVER invent a doctor_id, NEVER use placeholder names like "Doctor", and NEVER assign an unconfirmed doctor. If the user specifies a doctor by name (e.g. "Dr. Verma"), call 'list_doctors' to find their real doctor_id.
3. Availability & Slot: Always check available slots using 'check_availability' or confirm the requested date and time with the doctor's schedule.
4. Date & Time Format:
   - Date must always be formatted as YYYY-MM-DD. (Use today's date ${todayStr} to resolve terms like "today", "tomorrow", or relative dates).
   - Start time must always be formatted in 24-hour HH:MM (e.g. "09:30", "14:00").
5. Interactive Preview: Once patient, doctor, date, and start_time are confirmed, call 'request_appointment_booking' so staff receives an interactive preview confirmation card.
6. Grounded Truth: Never invent patient IDs, doctor IDs, or appointment time slots. Always invoke the provided tools to query real data.

Indian OPD abbreviations:
- c/o: complaining of
- f/u: follow up
- sos: as needed
- stat: immediately`;

    const model = getAiGatewayModel();
    const tools = getOperationsTools({
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
    console.error("[api/ai/operations-copilot] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
