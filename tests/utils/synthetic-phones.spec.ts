/**
 * The synthetic phone range (V2-03 03-13b, review finding M-SEEDPHONE): one fixed block, `+91 60000 000NN`, that every
 * seed uses and the messaging layer refuses to send to on every tier (03-13d's guard calls `isSyntheticPhone`).
 * Proves the range itself, its recognition in every spelling a provider or form might carry, and that every number
 * the demo-clinic seed (local stack and staging) writes is in it.
 */
import { describe, expect, it } from "vitest";
import { INDIAN_MOBILE_REGEX, toIndianMobileE164Strict } from "@/lib/utils/phone";
import {
  SYNTHETIC_PHONE_COUNT,
  SYNTHETIC_PHONE_E164_PATTERN,
  SYNTHETIC_PHONE_RANGE,
  isSyntheticPhone,
  syntheticPhone,
} from "@/lib/utils/synthetic-phones";
import { DEMO_PATIENTS, LEGACY_DEMO_PHONES } from "@/scripts/seed/demo-clinic";

describe("synthetic phone range", () => {
  it("is +91 60000 000NN: 100 E.164 numbers that pass the app's own mobile rules", () => {
    expect(syntheticPhone(0)).toBe(SYNTHETIC_PHONE_RANGE.first);
    expect(syntheticPhone(SYNTHETIC_PHONE_COUNT - 1)).toBe(SYNTHETIC_PHONE_RANGE.last);
    expect(SYNTHETIC_PHONE_RANGE).toEqual({ first: "+916000000000", last: "+916000000099" });
    for (let i = 0; i < SYNTHETIC_PHONE_COUNT; i++) {
      const phone = syntheticPhone(i);
      expect(phone).toMatch(SYNTHETIC_PHONE_E164_PATTERN);
      expect(INDIAN_MOBILE_REGEX.test(phone.slice(3))).toBe(true);
      expect(toIndianMobileE164Strict(phone)).toBe(phone);
      expect(isSyntheticPhone(phone)).toBe(true);
    }
    for (const bad of [-1, 100, 1.5, Number.NaN]) expect(() => syntheticPhone(bad)).toThrow(RangeError);
  });

  it.each(["+916000000001", "916000000001", "6000000001", "06000000001", "00916000000001", "+91 60000 00001", "+91-60000-000-01", "(+91) 6000.0000.01"])(
    "recognises %s",
    (phone) => {
      expect(isSyntheticPhone(phone)).toBe(true);
    },
  );

  it.each([
    "+916000000100", // just past the range
    "+916000000110",
    "+916000001000",
    "+919000000001", // the pre-03-13b demo numbers are NOT synthetic: they may be real
    "+919800000001",
    "+16000000001", // another country
    "+91600000000", // too short
    "6000000001x",
    "",
    "not a phone",
  ])("does not treat %s as synthetic", (phone) => {
    expect(isSyntheticPhone(phone)).toBe(false);
  });

  it("null and undefined are not synthetic", () => {
    expect(isSyntheticPhone(null)).toBe(false);
    expect(isSyntheticPhone(undefined)).toBe(false);
  });
});

describe("the demo-clinic seed (local stack and staging) uses only synthetic numbers", () => {
  it("every DEMO_PATIENTS phone is in the synthetic range", () => {
    expect(DEMO_PATIENTS.length).toBeGreaterThan(0);
    for (const p of DEMO_PATIENTS) expect(isSyntheticPhone(p.phone), `${p.full_name}: ${p.phone}`).toBe(true);
    expect(new Set(DEMO_PATIENTS.map((p) => p.phone)).size).toBe(DEMO_PATIENTS.length);
  });

  it("the legacy numbers it migrates away from are outside the range (so the guard does not hide them)", () => {
    expect(LEGACY_DEMO_PHONES).toHaveLength(DEMO_PATIENTS.length);
    for (const phone of LEGACY_DEMO_PHONES) expect(isSyntheticPhone(phone)).toBe(false);
  });
});
