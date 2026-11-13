/**
 * Seeded phone numbers stay in the synthetic range (V2-03 03-13b, review finding M-SEEDPHONE).
 *
 * India has no reserved fictional mobile range. Every real messaging provider refuses the block `+91 90000 000xx`
 * (`lib/messaging/synthetic-numbers.ts`, the 03-13d guard), so a seeded environment can never message a stranger, as
 * long as every seeded number is inside that block. This spec binds the demo-clinic seed (local stack and staging) to
 * the guard's own constant: a seed number outside the guarded range fails here (the DB integration spec checks the
 * rows the seed actually writes).
 */
import { describe, expect, it } from "vitest";
import { isSyntheticPhone, SYNTHETIC_PHONE_PREFIX } from "@/lib/messaging/synthetic-numbers";
import { INDIAN_MOBILE_REGEX } from "@/lib/utils/phone";
import { DEMO_PATIENTS } from "@/scripts/seed/demo-clinic";

describe("the demo-clinic seed uses only the guarded synthetic range", () => {
  it("every DEMO_PATIENTS phone is in the range every real provider refuses", () => {
    expect(DEMO_PATIENTS.length).toBeGreaterThan(0);
    for (const p of DEMO_PATIENTS) {
      expect(p.phone.startsWith(SYNTHETIC_PHONE_PREFIX), `${p.full_name}: ${p.phone}`).toBe(true);
      expect(isSyntheticPhone(p.phone), `${p.full_name}: ${p.phone}`).toBe(true);
    }
    expect(new Set(DEMO_PATIENTS.map((p) => p.phone)).size).toBe(DEMO_PATIENTS.length);
  });

  it("the seeded numbers still pass the app's own mobile rules (seeded patients behave like real ones)", () => {
    for (const p of DEMO_PATIENTS) expect(INDIAN_MOBILE_REGEX.test(p.phone.slice(3)), p.phone).toBe(true);
  });
});
