import { z } from "zod";

export const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z
      .string()
      .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    // PO-16 / V2-01 D8: the public REST API stays off unless explicitly enabled. Production refuses `true` until
    // P1-37 (ADR-0005 §17.1 G6 rule); `lib/api/enabled.ts` enforces the same at the request edge.
    API_V1_ENABLED: z.enum(["true", "false"]).default("false"),
  })
  .superRefine((value, issue) => {
    if (value.API_V1_ENABLED === "true" && value.NODE_ENV === "production") {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["API_V1_ENABLED"],
        message: "API_V1_ENABLED=true is not allowed in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parses an environment record; throws one error naming every invalid key (values are never echoed). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse({
    NODE_ENV: source.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    API_V1_ENABLED: source.API_V1_ENABLED === "" ? undefined : source.API_V1_ENABLED,
  });

  if (!parsed.success) {
    const errorMessages = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new Error(`Environment configuration error: ${errorMessages}`);
  }

  return parsed.data;
}

// Explicit `process.env.X` reads (not `process.env` as a whole) so Next can inline the public keys in client bundles.
export const env = parseEnv({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  API_V1_ENABLED: process.env.API_V1_ENABLED,
});
