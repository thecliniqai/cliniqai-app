"use server";

import { resolveServiceContext } from "@/lib/auth/context";
import * as macrosService from "./macros-service";
import type { DoctorMacro, MacroInput, MacroResult } from "./macros";
import { markAction } from "@/lib/observability/db-timing";

// Each action authenticates and checks permission before it reads any input, and derives the clinic and the doctor from the session (ADR-0005 D1);
// the service runs under the caller's JWT, so the database shows and changes only the signed-in doctor's own macros (migration 000115).

export async function listDoctorMacros(): Promise<MacroResult<DoctorMacro[]>> {
  await markAction("consultation_macros_actions.list_doctor_macros");
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return macrosService.listDoctorMacros(resolved.ctx);
}

export async function createDoctorMacro(input: MacroInput): Promise<MacroResult<DoctorMacro>> {
  await markAction("consultation_macros_actions.create_doctor_macro");
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return macrosService.createDoctorMacro(resolved.ctx, input);
}

export async function updateDoctorMacro(macroId: string, input: MacroInput): Promise<MacroResult<DoctorMacro>> {
  await markAction("consultation_macros_actions.update_doctor_macro");
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return macrosService.updateDoctorMacro(resolved.ctx, macroId, input);
}

export async function deleteDoctorMacro(macroId: string): Promise<MacroResult<{ id: string }>> {
  await markAction("consultation_macros_actions.delete_doctor_macro");
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return macrosService.deleteDoctorMacro(resolved.ctx, macroId);
}
