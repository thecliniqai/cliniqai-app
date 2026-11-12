// Lint-gate fixture (P0-01): must PASS when linted as features/<domain>/schema.ts.
import { z } from "zod";

const fieldsSchema = z.object({ name: z.string(), target_tenant_id: z.string().uuid().nullable(), doctor_id: z.string() });
export const inputSchema = fieldsSchema.omit({ doctor_id: true });
export type Stored = z.infer<typeof fieldsSchema> & { created_by: string; recorded_by?: string | null };
