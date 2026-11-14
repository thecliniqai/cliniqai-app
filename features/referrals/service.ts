import "server-only";
import { serverEnv } from "@/lib/env-server";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { visitInTenant } from "@/lib/auth/tenant-refs";
import { Referral } from "@/lib/db/types";
import { getSignedUrl, getStorageProviderForDb, VIEW_LINK_TTL_SECONDS } from "@/lib/storage";
import { createReferralSchema, closeReferralLoopSchema, acknowledgeReferralSchema } from "./schema";
import { ReferralItem, CreateReferralInput, CloseReferralLoopInput, ConsentedHistorySnapshot } from "./types";
import { generateAndArchiveReferralPdf } from "./pdf/generator";
import { createShareToken } from "@/features/sharing/tokens";
import { referralLetterPath } from "@/lib/storage/tenant-path";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { enqueueMessage } from "@/lib/jobs/enqueue";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { resolveTimeZone, ymdOf } from "@/lib/datetime";
import { clinicalNotesEmbed, withClinicalNotes } from "@/lib/db/clinical-notes";
import { mapDbError } from "@/lib/db/errors";

/** Fixed texts for the referral directory/consent trigger's reasons (migration 000062). */
const REFERRAL_INSERT_MESSAGES = {
  REFERRAL_TARGET_NOT_LISTED: "That clinic is not in the referral directory. Check the clinic ID with the partner clinic.",
  REFERRAL_CONSENT_REQUIRED: "Clinical history can only be shared with the patient's consent.",
  // 05-11b (000074): the target doctor must be an owner or doctor of the target clinic.
  REFERRAL_TARGET_DOCTOR_INVALID: "That doctor does not practise at the selected clinic. Choose a doctor of that clinic.",
} as const;

/**
 * Answer when the referral's DPDP consent record could not be written (V2-05 05a review IND L7, plan 05-11c): the
 * referral is withdrawn (history cleared, cancelled) and the action fails, so the history is never shared without a
 * consent record.
 */
export const REFERRAL_CONSENT_WRITE_FAILED =
  "The patient's consent could not be recorded, so the referral was not sent. Try again.";

/**
 * Creates a clinical referral (either out-of-network specialist or in-network partner clinic).
 * If in-network and patient consents to history sharing:
 * - Compiles snapshot of past encounters
 * - Records DPDP consent record in consent_records
 * - Compiles and archives branded PDF referral letter
 * - Logs audit trail
 */
export async function createReferral(
  ctx: ServiceContext,
  input: CreateReferralInput
): Promise<{ success: boolean; referral?: Referral; signedUrl?: string; error?: string }> {
  const parsed = createReferralSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid referral input",
    };
  }

  const supabase = ctx.db;
  assertPerm(ctx.role, "consultations:edit");
  const session = ctx;

  try {
    // 1. Fetch patient details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient, error: patientErr } = await (supabase.from("patients") as any)
      .select("id, full_name, phone, age, sex, address, abha_id")
      .eq("id", input.patient_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (patientErr || !patient) {
      return { success: false, error: "Patient not found." };
    }

    // A linked visit must be this clinic's visit of the same patient (P0-13: the FK and RLS do not check this; the
    // API-key path reads with the service role, so the tenant filters above and here are the only scoping).
    if (input.visit_id && !(await visitInTenant(ctx, input.visit_id, input.patient_id))) {
      return { success: false, error: "Visit not found." };
    }

    // 2. Fetch clinic info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: clinic } = await (supabase.from("tenants") as any)
      .select("name, address, phone, email, registration_number, timezone")
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
      const { data: pastVisitRows } = await (supabase.from("visits") as any)
        .select(`id, created_at, specialty, ${clinicalNotesEmbed(["chief_complaints", "vitals"])}`)
        .eq("patient_id", input.patient_id)
        .eq("tenant_id", session.tenantId)
        .order("created_at", { ascending: false })
        .limit(5);
      // Complaints and vitals come from clinical_notes (V2-05 05-02a).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pastVisits: any[] | null = pastVisitRows ? pastVisitRows.map(withClinicalNotes) : null;

      const encounterList: ConsentedHistorySnapshot["encounters"] = [];

      if (pastVisits && pastVisits.length > 0) {
        for (const v of pastVisits) {
          // Fetch diagnoses for visit
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: diagList } = await (supabase.from("consultation_diagnoses") as any)
            .select("diagnosis_name")
            .eq("visit_id", v.id)
            .eq("tenant_id", session.tenantId);

          // Fetch prescriptions for visit
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rxList } = await (supabase.from("prescriptions") as any)
            .select("id")
            .eq("visit_id", v.id)
            .eq("tenant_id", session.tenantId)
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
            visit_date: v.created_at ? ymdOf(v.created_at, resolveTimeZone(clinic?.timezone)) : "",
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
      // The directory/consent trigger (V2-05 05-06, migration 000062) refuses a target clinic that is not listed in
      // the referral directory (or is this clinic) and a history snapshot without the patient's consent.
      const mapped = mapDbError(insertErr, REFERRAL_INSERT_MESSAGES);
      if (mapped.reason && mapped.reason in REFERRAL_INSERT_MESSAGES) {
        return { success: false, error: mapped.message };
      }
      log.error({ event: "referrals.create_insert.failed", code: errorTag(insertErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to create referral." };
    }

    // 5b. Record the DPDP consent only once the referral exists (before 05-06 it was written first, so a refused
    // referral left a consent record behind). The write is checked (05-11c, IND L7): if it fails, the referral is
    // withdrawn (history cleared, cancelled; the referring clinic cannot delete it) and the action fails, so the target
    // clinic never holds the history without a consent record. One transaction for both writes is the V2-11 referral
    // command (RPC).
    if (consentedSnapshot) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: consentErr } = await (supabase.from("consent_records") as any).insert({
        tenant_id: session.tenantId,
        patient_id: input.patient_id,
        consent_type: "referral_history_sharing",
        status: "granted",
        recorded_by: session.userId,
        note: `DPDP consent granted for referral to clinic ${input.target_tenant_id}`,
      });
      if (consentErr) {
        log.error({ event: "referrals.consent_insert.failed", code: errorTag(consentErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: withdrawn, error: withdrawErr } = await (supabase.from("referrals") as any)
          .update({ consented_history_snapshot: null, status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", referral.id)
          .eq("tenant_id", session.tenantId)
          .select("id");
        if (withdrawErr || !Array.isArray(withdrawn) || withdrawn.length !== 1) {
          // The history stays with the target clinic without a consent record: alert-worthy.
          log.error({ event: "referrals.consent_withdraw.failed", code: withdrawErr ? errorTag(withdrawErr) : "ROW_NOT_AFFECTED", requestId: await getRequestId(), tenantId: ctx.tenantId });
        }
        return { success: false, error: REFERRAL_CONSENT_WRITE_FAILED };
      }

      await recordAudit(ctx, {
        action: "patient.consent.granted",
        entityType: "consent",
        metadata: {
          consent_type: "referral_history_sharing",
        },
      });
    }

    // 6. Generate and archive branded PDF referral letter
    let signedUrl: string | undefined;
    try {
      const pdfRes = await generateAndArchiveReferralPdf(ctx, {
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
      });
      signedUrl = pdfRes.signedUrl;
      referral.pdf_storage_path = pdfRes.storagePath;
    } catch (pdfErr) {
      log.error({ event: "referrals.pdf_compile.failed", code: errorTag(pdfErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }

    // 7. Audit log
    await recordAudit(ctx, {
      action: "referral.create",
      entityType: "referral",
      entityId: referral.id,
      metadata: {
        referral_type: referral.referral_type,
        urgency: referral.urgency,
        target_tenant_id: referral.target_tenant_id || undefined,
        patient_consents_history_sharing: referral.patient_consents_history_sharing,
      },
    });

    return {
      success: true,
      referral,
      signedUrl,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to create referral.", "referrals.create.failed"),
    };
  }
}

/**
 * Retrieves all outbound referrals initiated by the active clinic.
 */
export async function getOutboundReferrals(
  ctx: ServiceContext
): Promise<{ success: boolean; referrals: ReferralItem[]; error?: string }> {
  const supabase = ctx.db;
  assertPerm(ctx.role, "patients:view");
  const session = ctx;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("referrals") as any)
      .select(
        `
        *,
        patient:patients(id, full_name, phone, age, sex, abha_id)
      `
      )
      .eq("tenant_id", session.tenantId)
      .order("sent_at", { ascending: false });

    if (error) {
      log.error({ event: "referrals.outbound_list_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, referrals: [], error: "Failed to fetch outbound referrals." };
    }

    return { success: true, referrals: data || [] };
  } catch (err: unknown) {
    return {
      success: false,
      referrals: [],
      error: clientErrorMessage(err, "Failed to fetch outbound referrals.", "referrals.outbound_list.failed"),
    };
  }
}

/**
 * Retrieves all inbound referrals received from other partner clinics in-network.
 */
export async function getInboundReferrals(
  ctx: ServiceContext
): Promise<{ success: boolean; referrals: ReferralItem[]; error?: string }> {
  const supabase = ctx.db;
  assertPerm(ctx.role, "patients:view");
  const session = ctx;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("referrals") as any)
      .select(
        `
        *,
        patient:patients(id, full_name, phone, age, sex, abha_id)
      `
      )
      .eq("target_tenant_id", session.tenantId)
      .order("sent_at", { ascending: false });

    if (error) {
      log.error({ event: "referrals.inbound_list_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, referrals: [], error: "Failed to fetch inbound referrals." };
    }

    // Originating clinic names (ADR-0005 R15, V2-03 03-02): the receiving clinic cannot read the sender's tenant row
    // under RLS, so `referral_source_clinics` (000026, SECURITY DEFINER) returns id, name and phone only for tenants
    // that sent an RLS-visible referral to the caller's tenant. Called with the caller's own client; no service role.
    const originatingIds = Array.from(new Set((data || []).map((r: any) => r.tenant_id as string)));
    const clinicMap: Record<string, { id: string; name: string; phone: string | null }> = {};

    if (originatingIds.length > 0) {
      const { data: clinics, error: clinicsError } = await supabase.rpc("referral_source_clinics", {
        p_ids: originatingIds,
      });
      if (clinicsError) {
        log.error({ event: "referrals.source_clinics.failed", code: errorTag(clinicsError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      }
      for (const c of clinics || []) {
        clinicMap[c.id] = c;
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
      error: clientErrorMessage(err, "Failed to fetch inbound referrals.", "referrals.inbound_list.failed"),
    };
  }
}

/**
 * Marks an inbound referral as acknowledged by the receiving clinic.
 */
export async function acknowledgeReferral(
  ctx: ServiceContext,
  referralId: string
): Promise<{ success: boolean; error?: string }> {
  const parsed = acknowledgeReferralSchema.safeParse({ referral_id: referralId });
  if (!parsed.success) {
    return { success: false, error: "Invalid referral ID." };
  }

  const supabase = ctx.db;
  assertPerm(ctx.role, "consultations:edit");
  const session = ctx;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (supabase.from("referrals") as any)
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", referralId)
      // Only the receiving clinic, and only the one the caller is acting in (AR-M2b).
      .eq("target_tenant_id", session.tenantId)
      .select("id")
      .single();

    if (error || !updated) {
      if (error) log.error({ event: "referrals.acknowledge_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Referral not found or update failed." };
    }

    await recordAudit(ctx, {
      action: "referral.acknowledge",
      entityType: "referral",
      entityId: referralId,
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to acknowledge referral.", "referrals.acknowledge.failed"),
    };
  }
}

/**
 * Closes the referral loop for a returning patient by recording clinical return findings.
 * Transitions referral status to 'completed'.
 */
export async function closeReferralLoop(
  ctx: ServiceContext,
  input: CloseReferralLoopInput
): Promise<{ success: boolean; error?: string }> {
  const parsed = closeReferralLoopSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input.",
    };
  }

  const supabase = ctx.db;
  assertPerm(ctx.role, "consultations:edit");
  const session = ctx;

  try {
    const completedAt = input.return_date ? new Date(input.return_date).toISOString() : new Date().toISOString();

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

    await recordAudit(ctx, {
      action: "referral.close_loop",
      entityType: "referral",
      entityId: input.referral_id,
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to close referral loop.", "referrals.close_loop.failed"),
    };
  }
}

/**
 * Returns a short-lived (5-minute, `VIEW_LINK_TTL_SECONDS`; 06-09b N-1) signed URL for the referral letter PDF.
 */
export async function getReferralSignedUrl(
  ctx: ServiceContext,
  referralId: string
): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  const supabase = ctx.db;
  assertPerm(ctx.role, "consultations:view");
  const session = ctx;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: referral, error } = await (supabase.from("referrals") as any)
      .select("id, pdf_storage_path, tenant_id, target_tenant_id")
      .eq("id", referralId)
      .single();

    if (error || !referral || !referral.pdf_storage_path) {
      return { success: false, error: "Referral letter PDF not found." };
    }

    // Verify tenant authorization (either originating tenant or target tenant)
    if (referral.tenant_id !== session.tenantId && referral.target_tenant_id !== session.tenantId) {
      return { success: false, error: "Access denied." };
    }

    const storageProvider = getStorageProviderForDb(ctx.db, "clinic-records");

    // The letter's key is derived from the referral's own tenant and id (AR-M1, same rule as share_token_resource in
    // 000021); the stored pdf_storage_path is only a "has been generated" marker and is never signed as given.
    const { signedUrl } = await getSignedUrl(
      {
        path: referralLetterPath(referral.tenant_id, referral.id),
        expiresInSeconds: VIEW_LINK_TTL_SECONDS,
        bucket: "clinic-records",
      },
      storageProvider
    );
    return { success: true, signedUrl };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to generate signed URL.", "referrals.signed_url.failed"),
    };
  }
}

/**
 * Retrieves all referrals for a given patient under the active clinic.
 */
export async function getPatientReferrals(
  ctx: ServiceContext,
  patientId: string
): Promise<{ success: boolean; referrals: Referral[]; error?: string }> {
  const supabase = ctx.db;
  assertPerm(ctx.role, "patients:view");
  const session = ctx;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("referrals") as any)
      .select("*")
      .eq("patient_id", patientId)
      .eq("tenant_id", session.tenantId)
      .order("sent_at", { ascending: false });

    if (error) {
      log.error({ event: "referrals.patient_list_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, referrals: [], error: "Failed to fetch patient referrals." };
    }

    return { success: true, referrals: data || [] };
  } catch (err: unknown) {
    return {
      success: false,
      referrals: [],
      error: clientErrorMessage(err, "Failed to fetch patient referrals.", "referrals.patient_list.failed"),
    };
  }
}

/**
 * Shares an issued referral letter via WhatsApp with a 7-day secure tokenized link (/r/[token]).
 * Enqueues Event #8 (referral_letter_issued) outbox notification.
 */
export async function shareReferralLetterViaWhatsApp(
  ctx: ServiceContext,
  referralId: string
): Promise<{ success: boolean; shareUrl?: string; token?: string; error?: string }> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:view");
    const session = ctx;

    // 1. Fetch referral record joined with patient and tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ref, error: refErr } = await (supabase.from("referrals") as any)
      // referrals has two FKs to tenants (tenant_id, target_tenant_id): name the originating one, or PostgREST
      // refuses the ambiguous embed (PGRST201) and the share always failed.
      .select("*, patient:patients(id, full_name, phone), tenant:tenants!referrals_tenant_id_fkey(name, phone)")
      .eq("id", referralId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (refErr || !ref) {
      return { success: false, error: "Referral record not found." };
    }

    if (!ref.patient?.phone) {
      return { success: false, error: "Patient does not have a phone number registered." };
    }

    // 2. Secure 64-character token via create_share_token (tenant from the referral row, P0-04)
    const created = await createShareToken(supabase, "referral", ref.id);
    if (!created) {
      return { success: false, error: "Failed to generate secure share link." };
    }
    const { token } = created;

    const baseUrl = serverEnv().NEXT_PUBLIC_APP_URL;
    const shareUrl = `${baseUrl}/r/${token}`;

    // 3. Enqueue Event #8 (referral_letter_issued)
    // V2-04 04-03a: queued through the enqueue RPC; the job runner sends it (per-row key, R-24).
    await enqueueMessage(
      ctx,
      {
        patientId: ref.patient_id,
        channel: "whatsapp",
        messageType: "referral_letter_issued",
        templateId: "referral_letter_issued",
        templateParams: {
          patient_name: ref.patient.full_name || "Patient",
          specialist_name: ref.referred_to_name || "Specialist",
          clinic_name: ref.tenant?.name || "Clinic",
          document_url: shareUrl,
        },
        recipientPhone: ref.patient.phone,
        // No token or link in metadata (AR3-N1); the link travels only in template_params, redacted after sending.
        metadata: {
          referral_id: referralId,
        },
      }
    );

    // 4. Record audit log
    await recordAudit(ctx, {
      action: "referral.share_whatsapp",
      entityType: "referral",
      entityId: referralId,
      // No token or phone in the audit trail (AR-L5); the link itself is audited by create_share_token (000021).
    });

    return { success: true, shareUrl, token };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to share referral letter.", "referrals.whatsapp_share.failed"),
    };
  }
}
