import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { generateAndArchivePrescriptionPdf } from "@/features/prescriptions/pdf/generator";
import { PrescriptionPdfPayload } from "@/features/prescriptions/pdf/prescription-document";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: visitId } = await params;

    // 1. Authenticate user session
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // 2. Validate tenant membership server-side
    const membership = await getActiveMembership();

    // 3. Fetch visit data under strict tenant isolation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (supabase.from("visits") as any)
      .select("*")
      .eq("id", visitId)
      .eq("tenant_id", membership.tenantId)
      .single();

    if (visitErr || !visit) {
      return new NextResponse("Visit not found or access denied", { status: 404 });
    }

    // 4. Fetch clinic tenant details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("id, name, address, phone, registration_number, logo_url")
      .eq("id", membership.tenantId)
      .single();

    // 5. Fetch patient details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient } = await (supabase.from("patients") as any)
      .select("id, full_name, age, sex, phone, address, abha_id")
      .eq("id", visit.patient_id)
      .eq("tenant_id", membership.tenantId)
      .single();

    // 6. Fetch doctor membership info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doctorMember } = await (supabase.from("memberships") as any)
      .select("qualifications, medical_council_reg_no")
      .eq("tenant_id", membership.tenantId)
      .eq("user_id", visit.doctor_id)
      .maybeSingle();

    // 7. Fetch consultation diagnoses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diagnoses } = await (supabase.from("consultation_diagnoses") as any)
      .select("diagnosis_name, icd11_code, snomed_concept_id")
      .eq("visit_id", visitId)
      .eq("tenant_id", membership.tenantId)
      .order("created_at", { ascending: true });

    // 8. Fetch active prescription and items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prescription } = await (supabase.from("prescriptions") as any)
      .select("id, version, status, letterhead_mode, amendment_reason, signed_at")
      .eq("visit_id", visitId)
      .eq("tenant_id", membership.tenantId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    let items: Array<{
      medicine_name: string;
      generic_name?: string | null;
      dose_form?: string | null;
      dosage: string;
      timing?: string | null;
      duration: string;
      special_instructions?: string | null;
    }> = [];

    if (prescription?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rxItems } = await (supabase.from("prescription_items") as any)
        .select("medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order")
        .eq("prescription_id", prescription.id)
        .order("sort_order", { ascending: true });

      items = rxItems || [];
    }

    // 9. Fetch scheduled follow-up
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: followUp } = await (supabase.from("follow_ups") as any)
      .select("follow_up_date")
      .eq("visit_id", visitId)
      .eq("tenant_id", membership.tenantId)
      .maybeSingle();

    // 10. Parse query parameters
    const { searchParams } = new URL(request.url);
    const requestedLetterhead = searchParams.get("letterhead");
    const letterheadMode: "blank_paper" | "preprinted_letterhead" =
      requestedLetterhead === "preprinted_letterhead"
        ? "preprinted_letterhead"
        : prescription?.letterhead_mode === "preprinted_letterhead"
          ? "preprinted_letterhead"
          : "blank_paper";

    const isDownload = searchParams.get("download") === "true";

    // 11. Build payload
    const payload: PrescriptionPdfPayload = {
      tenant_id: membership.tenantId,
      visit_id: visit.id,
      prescription_id: prescription?.id || "",
      version: prescription?.version || 1,
      letterhead_mode: letterheadMode,
      amendment_reason: prescription?.amendment_reason || null,
      signed_at: visit.signed_at || prescription?.signed_at || null,
      clinic: {
        name: tenant?.name || "Clinic",
        address: tenant?.address || null,
        phone: tenant?.phone || null,
        registration_number: tenant?.registration_number || null,
        logo_url: tenant?.logo_url || null,
      },
      doctor: {
        name: user.user_metadata?.full_name || "Doctor",
        qualifications: doctorMember?.qualifications || null,
        medical_council_reg_no: doctorMember?.medical_council_reg_no || null,
      },
      patient: {
        full_name: patient?.full_name || "Patient",
        age: patient?.age || null,
        sex: patient?.sex || null,
        phone: patient?.phone || null,
        address: typeof patient?.address === "string" ? patient.address : null,
        abha_id: patient?.abha_id || null,
        uhid: patient?.id ? patient.id.slice(0, 8).toUpperCase() : null,
      },
      visit: {
        visit_date: (visit.scheduled_at || visit.created_at || new Date().toISOString()).split("T")[0],
        vitals: visit.vitals || null,
        chief_complaints: visit.chief_complaints || [],
        clinical_notes: visit.clinical_notes || null,
        specialty: visit.specialty || "general_physician",
      },
      diagnoses: (diagnoses || []).map((d: { diagnosis_name: string; icd11_code?: string; snomed_concept_id?: string }) => ({
        diagnosis_name: d.diagnosis_name,
        icd11_code: d.icd11_code || null,
        snomed_concept_id: d.snomed_concept_id || null,
      })),
      medications: items,
      investigations_advised: visit.investigations_advised || [],
      advice: visit.advice || [],
      follow_up_date: followUp?.follow_up_date || null,
    };

    // 12. Compile and archive PDF
    const { buffer } = await generateAndArchivePrescriptionPdf(payload, supabase as any, {
      userId: membership.userId,
      tenantId: membership.tenantId,
    });

    const cleanName = (patient?.full_name || "Patient").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `Rx-${cleanName}-${visit.id.slice(0, 8)}.pdf`;
    const disposition = isDownload
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err: unknown) {
    console.error("[app/api/visits/[id]/prescription-pdf] Error:", err);
    return new NextResponse(
      err instanceof Error ? err.message : "Internal Server Error",
      { status: 500 }
    );
  }
}
