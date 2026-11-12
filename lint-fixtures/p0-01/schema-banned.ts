// Lint-gate fixture (P0-01): must FAIL lint when linted as features/<domain>/schema.ts. Never imported.
import { z } from "zod";

export const createdBySchema = z.object({ name: z.string(), created_by: z.string().uuid() });
export const nestedRecordedBySchema = z.object({ vitals: z.object({ pulse: z.number(), recorded_by: z.string() }) });
export const extendSignedBySchema = createdBySchema.extend({ signed_by: z.string() });
export const stringKeyActorSchema = z.object({ "actor_id": z.string() });
export const tenantSchema = z.object({ tenant_id: z.string().uuid() });
