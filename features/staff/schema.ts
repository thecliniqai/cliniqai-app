import { z } from "zod";

/**
 * AUTH-05 staff removal input (V2-05 05-05). The clinic is never an input: `remove_member` takes it from the target
 * row and refuses anything outside the caller's active clinic. The reason is kept in the audit row (≤ 500 chars, no
 * control characters; the RPC re-checks both).
 */
export const removeStaffSchema = z.object({
  membershipId: z.string().uuid("Select a staff member to remove."),
  reason: z
    .string()
    .trim()
    .min(1, "Give a reason for removing this staff member.")
    .max(500, "Keep the reason under 500 characters.")
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "The reason contains characters that are not allowed."),
});

export type RemoveStaffInput = z.infer<typeof removeStaffSchema>;
