"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { ACTIVE_TENANT_COOKIE, createClient } from "@/lib/supabase/server";
import {
  activeClinicCookieOptions,
  CLINIC_SWITCH_MESSAGES,
  hasActiveMembership,
  activeClinicCookieSecure,
  resolveClinicSwitch,
} from "./switch";

const createClinicSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Clinic name must be at least 2 characters")
    .max(100, "Clinic name must be under 100 characters"),
});

export type CreateClinicResult =
  | { success: true; tenantId: string }
  | { success: false; error: string };

/**
 * Creates a clinic tenant and the caller's owner membership atomically in the DB. A user who already has an active membership
 * does not create a second clinic here (V2-08 08-05, R-17): a UX guard with a fixed text, not a security control; an invitation
 * into another clinic stays allowed and is the way to a second membership.
 */
export async function createClinic(formData: FormData): Promise<CreateClinicResult> {
  const rawName = formData.get("name");
  const parsed = createClinicSchema.safeParse({ name: rawName });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid clinic name",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to create a clinic",
    };
  }

  if (await hasActiveMembership()) {
    return { success: false, error: CLINIC_SWITCH_MESSAGES.ALREADY_MEMBER };
  }

  // Call the atomic database security-definer function
  const { data: tenantId, error: dbError } = await (
    supabase.rpc as unknown as (
      name: string,
      args: { p_name: string }
    ) => Promise<{ data: string | null; error: { message: string } | null }>
  )("create_clinic_with_owner", {
    p_name: parsed.data.name,
  });

  if (dbError) {
    return {
      success: false,
      // Fixed texts only (03-13d M-ERRMSG): the RPC's message can carry the caller's input.
      error: dbError.message.includes("unique")
        ? "Clinic creation conflict. Please try again."
        : "Unable to create the clinic. Please try again.",
    };
  }

  return {
    success: true,
    tenantId: tenantId as string,
  };
}

export type SwitchClinicResult = { success: true } | { success: false; error: string };

/**
 * The clinic switcher (V2-08 08-05, P1-12, R-17): pins this device to the clinic `clinicId` by setting the active-clinic cookie, only when
 * the signed-in caller holds an active membership of that clinic (read under RLS). A forged, foreign or removed clinic writes no
 * cookie and answers a fixed refusal. The caller navigates (hard, to /today) on success, which also drops every live channel and
 * in-memory state of the previous clinic. The tenant is never taken on trust afterwards: `getActiveMembership` re-checks the
 * membership on every request.
 */
export async function switchClinic(clinicId: string): Promise<SwitchClinicResult> {
  const target = await resolveClinicSwitch(clinicId);
  if (!target.ok) {
    const error =
      target.reason === "unavailable"
        ? CLINIC_SWITCH_MESSAGES.UNAVAILABLE
        : target.reason === "unauthenticated"
          ? CLINIC_SWITCH_MESSAGES.NOT_SIGNED_IN
          : CLINIC_SWITCH_MESSAGES.REFUSED;
    return { success: false, error };
  }
  (await cookies()).set(ACTIVE_TENANT_COOKIE, target.tenantId, activeClinicCookieOptions(activeClinicCookieSecure(await headers())));
  return { success: true };
}
