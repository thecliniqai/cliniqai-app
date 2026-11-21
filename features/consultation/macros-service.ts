import "server-only";

import { z } from "zod";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { unaffectedRowsError } from "@/lib/db/errors";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { macroInputSchema, MACRO_LIMIT, type DoctorMacro, type MacroInput, type MacroResult } from "./macros";

/**
 * The doctor's own text macros (V2-09b 09B-04b, R-14). Every statement runs under the caller's JWT, so RLS limits it to the signed-in doctor's own rows in
 * the active clinic (`doctor_id = auth.uid()`, consultations:edit; migration 000115); the tenant and the doctor come from the session, never from input
 * (the BEFORE INSERT trigger sets `doctor_id` itself). The expansion text is user content: it is never logged and never put in an audit row.
 */

const rowSchema = z.object({ id: z.string().uuid(), shortcut: z.string(), expansion: z.string() });

const SELECT = "id, shortcut, expansion";

/** The calling doctor's macros, by shortcut. */
export async function listDoctorMacros(ctx: ServiceContext): Promise<MacroResult<DoctorMacro[]>> {
  try {
    assertPerm(ctx.role, "consultations:edit");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db.from("doctor_text_macros") as any)
      .select(SELECT)
      .eq("tenant_id", ctx.tenantId)
      .eq("doctor_id", ctx.userId)
      .order("shortcut", { ascending: true })
      .limit(MACRO_LIMIT);
    if (error) return { success: false, error: "Could not load your macros." };
    return { success: true, value: z.array(rowSchema).parse(data ?? []) };
  } catch (err) {
    return { success: false, error: clientErrorMessage(err, "Could not load your macros.", "consultation.macros_list.failed") };
  }
}

function writeError(error: { code?: string; message?: string } | null, fallback: string): string {
  if (error?.code === "23505") return "You already have a macro with that shortcut.";
  if (error?.code === "23514" && /MACRO_LIMIT/.test(error.message ?? "")) return `You can keep at most ${MACRO_LIMIT} macros.`;
  return fallback;
}

export async function createDoctorMacro(ctx: ServiceContext, input: MacroInput): Promise<MacroResult<DoctorMacro>> {
  try {
    assertPerm(ctx.role, "consultations:edit");
    const parsed = macroInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the shortcut and the text." };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db.from("doctor_text_macros") as any)
      .insert({ tenant_id: ctx.tenantId, doctor_id: ctx.userId, shortcut: parsed.data.shortcut, expansion: parsed.data.expansion })
      .select(SELECT)
      .single();
    if (error || !data) return { success: false, error: writeError(error, "Could not save the macro.") };
    return { success: true, value: rowSchema.parse(data) };
  } catch (err) {
    return { success: false, error: clientErrorMessage(err, "Could not save the macro.", "consultation.macro_create.failed") };
  }
}

export async function updateDoctorMacro(ctx: ServiceContext, id: string, input: MacroInput): Promise<MacroResult<DoctorMacro>> {
  try {
    assertPerm(ctx.role, "consultations:edit");
    if (!z.string().uuid().safeParse(id).success) return { success: false, error: "Macro not found." };
    const parsed = macroInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the shortcut and the text." };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db.from("doctor_text_macros") as any)
      .update({ shortcut: parsed.data.shortcut, expansion: parsed.data.expansion })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .eq("doctor_id", ctx.userId)
      .select(SELECT);
    if (error) return { success: false, error: writeError(error, "Could not save the macro.") };
    // RLS answers a row that is not the caller's with success and no row: it is "not found" to them.
    if (unaffectedRowsError(data)) return { success: false, error: "Macro not found." };
    return { success: true, value: rowSchema.parse(data[0]) };
  } catch (err) {
    return { success: false, error: clientErrorMessage(err, "Could not save the macro.", "consultation.macro_update.failed") };
  }
}

export async function deleteDoctorMacro(ctx: ServiceContext, id: string): Promise<MacroResult<{ id: string }>> {
  try {
    assertPerm(ctx.role, "consultations:edit");
    if (!z.string().uuid().safeParse(id).success) return { success: false, error: "Macro not found." };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db.from("doctor_text_macros") as any)
      .delete()
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .eq("doctor_id", ctx.userId)
      .select("id");
    if (error) return { success: false, error: "Could not delete the macro." };
    if (unaffectedRowsError(data)) return { success: false, error: "Macro not found." };
    return { success: true, value: { id } };
  } catch (err) {
    return { success: false, error: clientErrorMessage(err, "Could not delete the macro.", "consultation.macro_delete.failed") };
  }
}
