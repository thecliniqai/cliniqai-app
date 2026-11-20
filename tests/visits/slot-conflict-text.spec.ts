/**
 * V2-07 07-04a G-4: the overbook dialog says WHY the slot is not free. The booking drawer passes `error.reason` (SLOT_TAKEN,
 * SLOT_OFF_DUTY, SLOT_BLOCKED) and the dialog's text comes from `overbookCauseText`, so each cause reads differently and an
 * unknown reason falls back to the taken-slot text. Pure data: no rendering needed.
 */
import { describe, expect, it } from "vitest";
import { SLOT_CONFLICT_REASONS, isSlotConflictReason, overbookCauseText } from "@/features/visits/slot-conflicts";

describe("overbookCauseText", () => {
  it("has its own title, headline, detail and question for each of the three causes", () => {
    const texts = SLOT_CONFLICT_REASONS.map((reason) => overbookCauseText(reason));
    for (const field of ["title", "headline", "question"] as const) {
      expect(new Set(texts.map((t) => t[field])).size, field).toBe(SLOT_CONFLICT_REASONS.length);
    }
    expect(new Set(texts.map((t) => t.detail("11:00 on 2031-03-04"))).size).toBe(SLOT_CONFLICT_REASONS.length);
  });

  it("names the cause: taken, outside the doctor's hours, blocked", () => {
    expect(overbookCauseText("SLOT_TAKEN").title).toBe("Slot Already Booked");
    expect(overbookCauseText("SLOT_OFF_DUTY").headline).toMatch(/outside the doctor's working hours/);
    expect(overbookCauseText("SLOT_OFF_DUTY").detail("11:00")).toContain("11:00");
    expect(overbookCauseText("SLOT_BLOCKED").headline).toMatch(/blocked/);
  });

  it("reads an unknown or missing reason as a taken slot, and every conflict reason is one the drawer treats as a conflict", () => {
    expect(overbookCauseText(undefined)).toBe(overbookCauseText("SLOT_TAKEN"));
    expect(overbookCauseText("SOMETHING_ELSE")).toBe(overbookCauseText("SLOT_TAKEN"));
    for (const reason of SLOT_CONFLICT_REASONS) expect(isSlotConflictReason(reason)).toBe(true);
  });
});
