"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Database, Referral } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSignedUrl, SupabaseStorageProvider } from "@/lib/storage";
import {
  createReferralSchema,
  closeReferralLoopSchema,
  acknowledgeReferralSchema,
} from "./schema";
import {
  ReferralItem,
  CreateReferralInput,
  CloseReferralLoopInput,
  ConsentedHistorySnapshot,
} from "./types";
import { generateAndArchiveReferralPdf } from "./pdf/generator";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<Database, any, any>;

/**
 * Creates a clinical referral (either out-of-network specialist or in-network partner clinic).
 * If in-network and patient consents to history sharing:
 * - Compiles snapshot of past encounters
 * - Records DPDP consent record in consent_records
 * - Compiles and archives branded PDF referral letter
 * - Logs audit trail
 */
export async function createReferral(
  input: CreateReferralInput,
  clientOverride?: AnySupabaseClient,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; referral?: Referral; signedUrl?: string; error?: string }> {
  const parsed = createReferralSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid referral input",
    };
  }

  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || (await requirePermission("patients:edit"));

  try {
    // 1. Fetch patient details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient, error: patientErr } = await (supabase.from("patients") as any)
      .select("id, full_name, phone, age, sex, address, abha_id")
      .eq("id", input.patient_id)
      .single();

    if (patientErr || !patient) {
      return { success: false, error: "Patient not found." };
    }

    // 2. Fetch clinic info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: clinic } = await (supabase.from("tenants") as any)
      .select("name, address, phone, email, registration_number")
      .eq("id", session.tenantId)
      .maybeSingle();

    // 3. Fetch doctor credentials from memberships
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doctorMember } = await (supabase.from("memberships") as any)
      .select("qualifications, medical_council_reg_no")
      .eq("tenant_id", session.tenantId)
      .eq("user_id", session.userId)
      .maybeSingle();

    // 4. Handle in-network history snapshot & DPDP consent if granted
    let consentedSnapshot: ConsentedHistorySnapshot | null = null;
    if (input.referral_type === "in_network" && input.patient_consents_history_sharing) {
      // Query past 5 encounters
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pastVisits } = await (supabase.from("visits") as any)
        .select("id, created_at, chief_complaints, vitals, specialty")
        .eq("patient_id", input.patient_id)
        .eq("tenant_id", session.tenantId)
        .order("created_at", { ascending: false })
        .limit(5);

      const encounterList: ConsentedHistorySnapshot["encounters"] = [];

      if (pastVisits && pastVisits.length > 0) {
        for (const v of pastVisits) {
          // Fetch diagnoses for visit
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: diagList } = await (supabase.from("consultation_diagnoses") as any)
            .select("diagnosis_name")
            .eq("visit_id", v.id);

          // Fetch prescriptions for visit
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rxList } = await (supabase.from("prescriptions") as any)
            .select("id")
            .eq("visit_id", v.id)
            .order("version", { ascending: false })
            .limit(1);

          let medItems: ConsentedHistorySnapshot["encounters"][0]["medications"] = [];
          if (rxList && rxList.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: items } = await (supabase.from("prescription_items") as any)
              .select("medicine_name, dosage, timing, duration")
              .eq("prescription_id", rxList[0].id);
            medItems = items || [];
          }

          encounterList.push({
            visit_id: v.id,
            visit_date: v.created_at ? v.created_at.split("T")[0] : "",
            chief_complaints: v.chief_complaints || [],
            diagnoses: (diagList || []).map((d: any) => d.diagnosis_name),
            vitals: v.vitals || null,
            medications: medItems,
          });
        }
      }

      consentedSnapshot = {
        generated_at: new Date().toISOString(),
        consented_by_patient: true,
        encounters: encounterList,
      };

      // Record DPDP consent in consent_records
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("consent_records") as any).insert({
        tenant_id: session.tenantId,
        patient_id: input.patient_id,
        consent_type: "referral_history_sharing",
        status: "granted",
        recorded_by: session.userId,
        note: `DPDP consent granted for referral to clinic ${input.target_tenant_id}`,
      });

      await recordAudit(
        {
          action: "patient.consent.granted",
          entityType: "consent",
          metadata: {
            consent_type: "referral_history_sharing",
          },
        },
        clientOverride,
        session
      );
    }

    // 5. Insert referral record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: referral, error: insertErr } = await (supabase.from("referrals") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id: input.patient_id,
        visit_id: input.visit_id || null,
        referral_type: input.referral_type,
        referring_doctor_id: session.userId,
        referred_to_name: input.referred_to_name,
        referred_to_facility: input.referred_to_facility || null,
        referred_to_specialty: input.referred_to_specialty || null,
        referred_to_contact: input.referred_to_contact || null,
        target_tenant_id: input.target_tenant_id || null,
        target_doctor_id: input.target_doctor_id || null,
        reason_for_referral: input.reason_for_referral,
        provisional_diagnosis: input.provisional_diagnosis || null,
        urgency: input.urgency || "routine",
        clinical_summary: input.clinical_summary || null,
        active_medications_snapshot: input.active_medications_snapshot || [],
        investigations_advised: input.investigations_advised || [],
        patient_consents_history_sharing: !!input.patient_consents_history_sharing,
        consented_history_snapshot: consentedSnapshot,
        status: "sent",
        letterhead_mode: input.letterhead_mode || "blank_paper",
      })
      .select("*")
      .single();

    if (insertErr || !referral) {
      console.error("[features/referrals/actions] Insert referral error:", insertErr);
      return { success: false, error: insertErr?.message || "Failed to create referral." };
    }

    // 6. Generate and archive branded PDF referral letter
    let signedUrl: string | undefined;
    try {
      const pdfRes = await generateAndArchiveReferralPdf(
        {
          referral_id: referral.id,
          tenant_id: session.tenantId,
          letterhead_mode: referral.letterhead_mode,
          urgency: referral.urgency,
          sent_at: referral.sent_at,
          clinic: {
            name: clinic?.name || "Clinic",
            address: clinic?.address || null,
            phone: clinic?.phone || null,
            email: clinic?.email || null,
            registration_number: clinic?.registration_number || null,
          },
          referring_doctor: {
            name: "Consulting Physician",
            qualifications: doctorMember?.qualifications || null,
            medical_council_reg_no: doctorMember?.medical_council_reg_no || null,
          },
          recipient: {
            name: referral.referred_to_name,
            facility: referral.referred_to_facility,
            specialty: referral.referred_to_specialty,
            contact: referral.referred_to_contact,
          },
          patient: {
            full_name: patient.full_name,
            age: patient.age,
            sex: patient.sex,
            phone: patient.phone,
            uhid: patient.uhid,
            address: patient.address,
          },
          clinical: {
            reason_for_referral: referral.reason_for_referral,
            provisional_diagnosis: referral.provisional_diagnosis,
            clinical_summary: referral.clinical_summary,
            medications: (referral.active_medications_snapshot as any[]) || [],
            investigations_advised: referral.investigations_advised || [],
          },
        },
        clientOverride,
        sessionOverride
      );
      signedUrl = pdfRes.signedUrl;
      referral.pdf_storage_path = pdfRes.storagePath;
    } catch (pdfErr) {
      console.error("[features/referrals/actions] PDF compilation error:", pdfErr);
    }

    // 7. Audit log
    await recordAudit(
      {
        action: "referral.create",
        entityType: "referral",
        entityId: referral.id,
        metadata: {
          referral_type: referral.referral_type,
          urgency: referral.urgency,
          target_tenant_id: referral.target_tenant_id || undefined,
          patient_consents_history_sharing: referral.patient_consents_history_sharing,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/referrals");
      revalidatePath(`/patients/${input.patient_id}`);
    } catch {
      // Ignore during test execution
    }

    return {
      success: true,
      referral,
      signedUrl,
    };
  } catch (err: unknown) {
    console.error("[features/referrals/actions] createReferral error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create referral.",
    };
  }
}

/**
 * Retrieves all outbound referrals initiated by the active clinic.
 */
export async function getOutboundReferrals(
  clientOverride?: AnySupabaseClient,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; referrals: ReferralItem[]; error?: string }> {
  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || (await requirePermission("patients:view"));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("referrals") as any)
      .select(`
        *,
        patient:patients(id, full_name, phone, age, sex, abha_id)
      `)
      .eq("tenant_id", session.tenantId)
      .order("sent_at", { ascending: false });

    if (error) {
      return { success: false, referrals: [], error: error.message };
    }

    return { success: true, referrals: data || [] };
  } catch (err: unknown) {
    return {
      success: false,
      referrals: [],
      error: err instanceof Error ? err.message : "Failed to fetch outbound referrals.",
    };
  }
}

/**
 * Retrieves all inbound referrals received from other partner clinics in-network.
 */
export async function getInboundReferrals(
  clientOverride?: AnySupabaseClient,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; referrals: ReferralItem[]; error?: string }> {
  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || (await requirePermission("patients:view"));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("referrals") as any)
      .select(`
        *,
        patient:patients(id, full_name, phone, age, sex, abha_id)
      `)
      .eq("target_tenant_id", session.tenantId)
      .order("sent_at", { ascending: false });

    if (error) {
      return { success: false, referrals: [], error: error.message };
    }

    // Hydrate originating clinic names using admin client to bypass tenant RLS
    const originatingIds = Array.from(new Set((data || []).map((r: any) => r.tenant_id)));
    const clinicMap: Record<string, { id: string; name: string; phone: string | null }> = {};

    if (originatingIds.length > 0) {
      try {
        const { getAdminClient } = await import("@/lib/supabase/admin");
        const adminSupabase = getAdminClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: clinics } = await (adminSupabase.from("tenants") as any)
          .select("id, name, phone")
          .in("id", originatingIds);

        if (clinics) {
          for (const c of clinics) {
            clinicMap[c.id] = c;
          }
        }
      } catch {
        // Fallback to client if admin client cannot be created
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: clinics } = await (supabase.from("tenants") as any)
          .select("id, name, phone")
          .in("id", originatingIds);

        if (clinics) {
          for (const c of clinics) {
            clinicMap[c.id] = c;
          }
        }
      }
    }

    const items: ReferralItem[] = (data || []).map((r: any) => ({
      ...r,
      originating_clinic: clinicMap[r.tenant_id] || null,
    }));

    return { success: true, referrals: items };
  } catch (err: unknown) {
    return {
      success: false,
      referrals: [],
      error: err instanceof Error ? err.message : "Failed to fetch inbound referrals.",
    };
  }
}

/**
 * Marks an inbound referral as acknowledged by the receiving clinic.
 */
export async function acknowledgeReferral(
  referralId: string,
  clientOverride?: AnySupabaseClient,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; error?: string }> {
  const parsed = acknowledgeReferralSchema.safeParse({ referral_id: referralId });
  if (!parsed.success) {
    return { success: false, error: "Invalid referral ID." };
  }

  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || (await requirePermission("patients:edit"));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (supabase.from("referrals") as any)
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", referralId)
      .select("id")
      .single();

    if (error || !updated) {
      return { success: false, error: error?.message || "Referral not found or update failed." };
    }

    await recordAudit(
      {
        action: "referral.acknowledge",
        entityType: "referral",
        entityId: referralId,
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/referrals");
    } catch {
      // Ignore during test execution
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to acknowledge referral.",
    };
  }
}

/**
 * Closes the referral loop for a returning patient by recording clinical return findings.
 * Transitions referral status to 'completed'.
 */
export async function closeReferralLoop(
  input: CloseReferralLoopInput,
  clientOverride?: AnySupabaseClient,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; error?: string }> {
  const parsed = closeReferralLoopSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input.",
    };
  }

  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || (await requirePermission("patients:edit"));

  try {
    const completedAt = input.return_date
      ? new Date(input.return_date).toISOString()
      : new Date().toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (supabase.from("referrals") as any)
      .update({
        status: "completed",
        closure_notes: input.closure_notes,
        completed_at: completedAt,
        closed_by: session.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.referral_id)
      .eq("tenant_id", session.tenantId)
      .select("id, patient_id")
      .single();

    if (error || !updated) {
      return {
        success: false,
        error: "Referral not found or access denied.",
      };
    }

    await recordAudit(
      {
        action: "referral.close_loop",
        entityType: "referral",
        entityId: input.referral_id,
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/referrals");
      if (updated.patient_id) {
        revalidatePath(`/patients/${updated.patient_id}`);
      }
    } catch {
      // Ignore during test execution
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to close referral loop.",
    };
  }
}

/**
 * Returns a short-lived (3600s) signed URL for the referral letter PDF.
 */
export async function getReferralSignedUrl(
  referralId: string,
  clientOverride?: AnySupabaseClient,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || (await requirePermission("patients:view"));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: referral, error } = await (supabase.from("referrals") as any)
      .select("pdf_storage_path, tenant_id, target_tenant_id")
      .eq("id", referralId)
      .single();

    if (error || !referral || !referral.pdf_storage_path) {
      return { success: false, error: "Referral letter PDF not found." };
    }

    // Verify tenant authorization (either originating tenant or target tenant)
    if (
      referral.tenant_id !== session.tenantId &&
      referral.target_tenant_id !== session.tenantId
    ) {
      return { success: false, error: "Access denied." };
    }

    const storageProvider = clientOverride
      ? new SupabaseStorageProvider({ defaultBucket: "clinic-records", client: clientOverride })
      : undefined;

    const { signedUrl } = await getSignedUrl(
      {
        path: referral.pdf_storage_path,
        expiresInSeconds: 3600,
        bucket: "clinic-records",
      },
      storageProvider
    );
    return { success: true, signedUrl };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate signed URL.",
    };
  }
}

/**
 * Retrieves all referrals for a given patient under the active clinic.
 */
export async function getPatientReferrals(
  patientId: string,
  clientOverride?: AnySupabaseClient,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; referrals: Referral[]; error?: string }> {
  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || (await requirePermission("patients:view"));

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("referrals") as any)
      .select("*")
      .eq("patient_id", patientId)
      .eq("tenant_id", session.tenantId)
      .order("sent_at", { ascending: false });

    if (error) {
      return { success: false, referrals: [], error: error.message };
    }

    return { success: true, referrals: data || [] };
  } catch (err: unknown) {
    return {
      success: false,
      referrals: [],
      error: err instanceof Error ? err.message : "Failed to fetch patient referrals.",
    };
  }
}
