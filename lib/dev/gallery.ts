import type { AppEnv } from "@/lib/env";

/**
 * The `/dev/ui` component gallery (V2-06 06-02a, R-26): on every tier except production. It still needs a session
 * (the default-deny proxy), and it renders synthetic copy only. An unknown or missing tier enables nothing.
 */
export function galleryEnabled(appEnv: AppEnv | undefined | null): boolean {
  return appEnv !== undefined && appEnv !== null && appEnv !== "production";
}
