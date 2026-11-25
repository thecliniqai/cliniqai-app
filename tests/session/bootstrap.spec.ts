/**
 * The session bootstrap's allow-list on the device (V2-09e 09E-13, R-13, T-09E-10): `parseSessionBootstrap` (zod, every object strict) is the only way an
 * answer enters the shell's memory, so a key outside the allow-list, at any level, is refused and nothing is held. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { clinicLabel, parseSessionBootstrap, switcherClinics } from "@/features/session/bootstrap";

const T = "c1310000-0000-4000-8000-00000000000a";
const U = "c1310000-0000-4000-8000-000000000101";
const D = "c1310000-0000-4000-8000-000000000102";

const valid = () => ({
  profile: { id: U, full_name: "Synthetic Owner" },
  clinic: { id: T, name: "Synthetic Clinic", zone: "Asia/Kolkata" },
  role: "owner",
  doctors: [{ id: D, full_name: "Synthetic Doctor", specialty: "general_medicine" }],
  clinics: [{ id: T, name: "Synthetic Clinic" }],
  rx_print: { paper_size: "A4", letterhead_mode: "blank_paper", top_margin: null, bottom_margin: null },
  versions: { settings: 3 },
});

describe("parseSessionBootstrap: the allow-list", () => {
  it("holds a valid answer exactly as given", () => {
    expect(parseSessionBootstrap(valid())).toEqual(valid());
  });

  it.each([
    ["a fee at the top", (b: Record<string, unknown>) => ({ ...b, default_consultation_fee: 500 })],
    ["the access level", (b: Record<string, unknown>) => ({ ...b, access: "full" })],
    ["permissions", (b: Record<string, unknown>) => ({ ...b, permissions: ["billing:collect"] })],
    ["a fee in the clinic", (b: Record<string, unknown>) => ({ ...b, clinic: { ...(b.clinic as object), default_consultation_fee: 500 } })],
    ["a subscription in the clinic", (b: Record<string, unknown>) => ({ ...b, clinic: { ...(b.clinic as object), subscription: "trialing" } })],
    ["a phone in the profile", (b: Record<string, unknown>) => ({ ...b, profile: { ...(b.profile as object), phone: "+919000000000" } })],
    ["availability in a doctor", (b: Record<string, unknown>) => ({ ...b, doctors: [{ ...(b.doctors as object[])[0], availability_schedule: {} }] })],
    ["a role in a clinic of the switcher", (b: Record<string, unknown>) => ({ ...b, clinics: [{ ...(b.clinics as object[])[0], role: "owner" }] })],
    ["a logo in the print settings", (b: Record<string, unknown>) => ({ ...b, rx_print: { ...(b.rx_print as object), logo_url: "x" } })],
    ["another domain's version", (b: Record<string, unknown>) => ({ ...b, versions: { settings: 3, billing: 9 } })],
  ])("refuses an extra key (%s): nothing is held", (_name, add) => {
    expect(parseSessionBootstrap(add(valid()))).toBeNull();
  });

  it.each([
    ["no versions", (b: Record<string, unknown>) => ({ ...b, versions: undefined })],
    ["an unknown role", (b: Record<string, unknown>) => ({ ...b, role: "superuser" })],
    ["a negative version", (b: Record<string, unknown>) => ({ ...b, versions: { settings: -1 } })],
    ["an id that is not a uuid", (b: Record<string, unknown>) => ({ ...b, clinic: { ...(b.clinic as object), id: "clinic-a" } })],
  ])("refuses a malformed answer (%s)", (_name, change) => {
    expect(parseSessionBootstrap(change(valid()))).toBeNull();
  });

  it("refuses null (the function's answer for a non-member) and a non-object", () => {
    expect(parseSessionBootstrap(null)).toBeNull();
    expect(parseSessionBootstrap("owner")).toBeNull();
  });
});

describe("the shell's views of it", () => {
  it("orders the switcher's clinics by name, then id, and names an empty one Clinic", () => {
    const a = "00000000-0000-4000-8000-00000000000a";
    const b = "00000000-0000-4000-8000-00000000000b";
    const c = "00000000-0000-4000-8000-00000000000c";
    expect(switcherClinics({ clinics: [{ id: b, name: "Beta" }, { id: c, name: " " }, { id: a, name: "Beta" }] })).toEqual([
      { id: a, name: "Beta" },
      { id: b, name: "Beta" },
      { id: c, name: "Clinic" },
    ]);
    expect(clinicLabel("  Synthetic  ")).toBe("Synthetic");
  });
});
