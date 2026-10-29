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

    const systemPrompt = `You are the ClinicOS Global Operations Copilot for clinic staff.
Current Route Context: ${screenContext?.screen || "Dashboard"} | Staff Role: ${role}.
You assist clinic staff with searching patients, checking doctor schedule/availability, staging appointment bookings, rescheduling, cancellations, and checking queue status.
Never invent patient IDs, doctor IDs, or appointment time slots. Always invoke the provided tools to query real data.
For any mutation (booking, rescheduling, cancellation), stage the action using the appropriate tool so that the user receives an interactive preview confirmation card.
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
