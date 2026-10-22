import { z } from "zod";

export const createReferralSchema = z
  .object({
    patient_id: z.string().uuid("Invalid patient ID"),
    visit_id: z.string().uuid("Invalid visit ID").optional().nullable(),
    referral_type: z.enum(["out_of_network", "in_network"]),
    referred_to_name: z.string().min(2, "Specialist or doctor name is required"),
    referred_to_facility: z.string().optional().nullable(),
    referred_to_specialty: z.string().optional().nullable(),
    referred_to_contact: z.string().optional().nullable(),
    target_tenant_id: z.string().uuid("Invalid target clinic ID").optional().nullable(),
    target_doctor_id: z.string().uuid("Invalid target doctor ID").optional().nullable(),
    reason_for_referral: z.string().min(3, "Reason for referral is required"),
    provisional_diagnosis: z.string().optional().nullable(),
    urgency: z.enum(["routine", "priority", "urgent"]).default("routine"),
    clinical_summary: z.string().optional().nullable(),
    active_medications_snapshot: z.array(z.record(z.unknown())).optional().nullable(),
    investigations_advised: z.array(z.string()).optional().nullable(),
    patient_consents_history_sharing: z.boolean().default(false),
    letterhead_mode: z.enum(["blank_paper", "preprinted_letterhead"]).default("blank_paper"),
  })
  .refine(
    (data) => {
      if (data.referral_type === "in_network" && !data.target_tenant_id) {
        return false;
      }
      return true;
    },
    {
      message: "Target partner clinic is required for in-network referrals",
      path: ["target_tenant_id"],
    }
  );

export const closeReferralLoopSchema = z.object({
  referral_id: z.string().uuid("Invalid referral ID"),
  closure_notes: z.string().min(3, "Clinical return findings and follow-up plan are required (min 3 chars)"),
  return_date: z.string().optional().nullable(),
});

export const acknowledgeReferralSchema = z.object({
  referral_id: z.string().uuid("Invalid referral ID"),
});

export type CreateReferralSchemaInput = z.infer<typeof createReferralSchema>;
export type CloseReferralLoopSchemaInput = z.infer<typeof closeReferralLoopSchema>;
