import { describe, expect, it } from "vitest";
import { bandOf, suggestSlots, type FreeSlot } from "@/features/visits/suggest-slots";

/**
 * Smart Assist slot suggestions (V2-08 08-05, AI-13, R-18): the pure ranking behind the booking sheet's "Suggested times".
 * A suggestion is a start from which consecutive free grid slots cover the doctor's average consult; the patient's usual time of
 * day ranks first, then the earliest; the top three and the "next free" one are answered.
 */
const grid = (start: string, count: number, minutes = 15): FreeSlot[] => {
  const [h, m] = start.split(":").map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const total = h! * 60 + m! + i * minutes;
    return { time: `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`, minutes };
  });
};
const times = (list: { time: string }[]) => list.map((s) => s.time);

describe("suggestSlots", () => {
  const morning = grid("10:00", 8); // 10:00 .. 11:45
  const evening = grid("17:00", 8); // 17:00 .. 18:45
  const day = [...morning, ...evening];

  it("ranks the patient's preferred band first, then the earliest, and keeps the earliest overall as next free", () => {
    const out = suggestSlots({ slots: day, avgConsultMinutes: null, preferredBand: "evening" });
    expect(times(out.top)).toEqual(["17:00", "17:15", "17:30"]);
    expect(out.top.every((s) => s.inPreferredBand)).toBe(true);
    expect(out.nextFree?.time).toBe("10:00");
  });

  it("without history the three earliest are suggested", () => {
    const out = suggestSlots({ slots: day, avgConsultMinutes: null, preferredBand: null });
    expect(times(out.top)).toEqual(["10:00", "10:15", "10:30"]);
    expect(out.top.some((s) => s.inPreferredBand)).toBe(false);
    expect(out.nextFree?.time).toBe("10:00");
  });

  it("a preferred band with no free slot falls back to the earliest", () => {
    const out = suggestSlots({ slots: morning, avgConsultMinutes: null, preferredBand: "afternoon" });
    expect(times(out.top)).toEqual(["10:00", "10:15", "10:30"]);
  });

  it("when the preferred band has fewer than three, the rest are the earliest of the others", () => {
    const slots = [...grid("10:00", 4), { time: "13:00", minutes: 15 }];
    const out = suggestSlots({ slots, avgConsultMinutes: null, preferredBand: "afternoon" });
    expect(times(out.top)).toEqual(["13:00", "10:00", "10:15"]);
  });

  it("a 30-minute average needs two consecutive grid slots, so a lone slot is not suggested", () => {
    const slots = [{ time: "09:00", minutes: 15 }, ...grid("10:00", 2)];
    const out = suggestSlots({ slots, avgConsultMinutes: 30, preferredBand: null });
    expect(times(out.top)).toEqual(["10:00"]);
    expect(out.nextFree?.time).toBe("10:00");
  });

  it("a 20-minute average still needs two 15-minute slots (the consult is covered, not rounded down)", () => {
    const out = suggestSlots({ slots: grid("10:00", 3), avgConsultMinutes: 20, preferredBand: null });
    expect(times(out.top)).toEqual(["10:00", "10:15"]);
  });

  it("back-to-back booked time breaks a run: 10:00, 10:15 then a gap then 11:00 gives 10:00 only for 30 minutes", () => {
    const slots = [...grid("10:00", 2), { time: "11:00", minutes: 15 }];
    const out = suggestSlots({ slots, avgConsultMinutes: 30, preferredBand: null });
    expect(times(out.top)).toEqual(["10:00"]);
  });

  it("slots longer than the average need no neighbour", () => {
    const out = suggestSlots({ slots: grid("10:00", 3, 30), avgConsultMinutes: 25, preferredBand: null });
    expect(times(out.top)).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("slots before the cut-off (past times today) are dropped", () => {
    const out = suggestSlots({ slots: morning, avgConsultMinutes: null, preferredBand: null, notBefore: "10:40" });
    expect(times(out.top)).toEqual(["10:45", "11:00", "11:15"]);
    expect(out.nextFree?.time).toBe("10:45");
  });

  it("one slot left: it is the suggestion for a one-slot visit, and nothing for a longer average", () => {
    const one = [{ time: "11:45", minutes: 15 }];
    expect(times(suggestSlots({ slots: one, avgConsultMinutes: null, preferredBand: null }).top)).toEqual(["11:45"]);
    const none = suggestSlots({ slots: one, avgConsultMinutes: 30, preferredBand: "morning" });
    expect(none.top).toEqual([]);
    expect(none.nextFree).toBeNull();
  });

  it("no free slot at all: no suggestions", () => {
    expect(suggestSlots({ slots: [], avgConsultMinutes: 15, preferredBand: "morning" })).toEqual({ top: [], nextFree: null });
  });

  it("an unsorted or duplicated list gives the same answer as a sorted one", () => {
    const shuffled = [...morning].reverse().concat(morning.slice(0, 2));
    const a = suggestSlots({ slots: shuffled, avgConsultMinutes: 30, preferredBand: null });
    const b = suggestSlots({ slots: morning, avgConsultMinutes: 30, preferredBand: null });
    expect(a).toEqual(b);
  });

  it("ignores malformed times and non-positive lengths", () => {
    const out = suggestSlots({
      slots: [{ time: "ten", minutes: 15 }, { time: "10:00", minutes: 0 }, { time: "10:15", minutes: 15 }],
      avgConsultMinutes: null,
      preferredBand: null,
    });
    expect(times(out.top)).toEqual(["10:15"]);
  });

  it("a zero or null average is the one-slot rule", () => {
    const a = suggestSlots({ slots: grid("10:00", 2), avgConsultMinutes: 0, preferredBand: null });
    const b = suggestSlots({ slots: grid("10:00", 2), avgConsultMinutes: null, preferredBand: null });
    expect(a).toEqual(b);
    expect(times(a.top)).toEqual(["10:00", "10:15"]);
  });

  it("bands match the slot picker: morning before 12:00, afternoon before 17:00, evening from 17:00", () => {
    expect(["11:45", "12:00", "16:45", "17:00", "00:00"].map(bandOf)).toEqual(["morning", "afternoon", "afternoon", "evening", "morning"]);
  });
});
