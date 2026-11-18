/**
 * The `/dev/ui` gate (V2-06 06-02a, R-26): the gallery exists on every tier except production, and an unknown tier
 * enables nothing (fail closed). The route's own 404 in production is this function's answer; the signed-out redirect
 * and the rendered gallery are asserted in tests/e2e/design/gallery-axe.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { galleryEnabled } from "@/lib/dev/gallery";
import { APP_ENVS } from "@/lib/env";

describe("galleryEnabled", () => {
  it("is false only for production among the known tiers", () => {
    const answers = Object.fromEntries(APP_ENVS.map((tier) => [tier, galleryEnabled(tier)]));
    expect(answers).toEqual({
      development: true,
      test: true,
      e2e: true,
      ci: true,
      staging: true,
      production: false,
    });
  });

  it("is false when the tier is unknown", () => {
    expect(galleryEnabled(undefined)).toBe(false);
    expect(galleryEnabled(null)).toBe(false);
  });
});
