import { afterEach, describe, expect, it } from "vitest";
import { clinicHHmm, earliestSlot, slotInstant, toPickerSlots } from "@/components/front-desk/slot-adapter";

/**
 * The slot adapter is the one place that turns the database's UTC slot instants into the clinic's `HH:mm` and back
 * (V2-08 08-04b, ADR-016). Whatever zone the process or the browser runs in, 10:00 am IST is 10:00 on the picker and
 * 04:30Z on the wire.
 */
const IST = "Asia/Kolkata";
const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(["UTC", "America/Los_Angeles", "Asia/Kolkata"])("with the process zone %s", (zone) => {
  it("shows a 04:30Z slot as 10:00 in the clinic's zone and sends 10:00 as 04:30Z", () => {
    process.env.TZ = zone;
    const slots = toPickerSlots([{ start: "2026-12-01T04:30:00.000Z", end: "2026-12-01T04:45:00.000Z" }], IST);
    expect(slots).toEqual([{ time: "10:00" }]);
    expect(slotInstant("2026-12-01", "10:00", IST)).toBe("2026-12-01T04:30:00.000Z");
  });

  it("keeps the clinic date line: 00:30 IST is 19:00Z of the day before", () => {
    process.env.TZ = zone;
    expect(clinicHHmm("2026-11-30T19:00:00.000Z", IST)).toBe("00:30");
    expect(slotInstant("2026-12-01", "00:30", IST)).toBe("2026-11-30T19:00:00.000Z");
  });

  it("is the identity round trip for every quarter hour of an evening shift", () => {
    process.env.TZ = zone;
    for (const time of ["17:00", "17:15", "20:45"]) {
      expect(clinicHHmm(slotInstant("2026-12-02", time, IST), IST)).toBe(time);
    }
  });
});

describe("toPickerSlots and earliestSlot", () => {
  it("sorts, drops duplicates and names the earliest", () => {
    const slots = toPickerSlots(
      [
        { start: "2026-12-01T12:00:00.000Z", end: "2026-12-01T12:15:00.000Z" },
        { start: "2026-12-01T04:30:00.000Z", end: "2026-12-01T04:45:00.000Z" },
        { start: "2026-12-01T04:30:00.000Z", end: "2026-12-01T04:45:00.000Z" },
      ],
      IST,
    );
    expect(slots.map((s) => s.time)).toEqual(["10:00", "17:30"]);
    expect(earliestSlot(slots)).toBe("10:00");
    expect(earliestSlot([])).toBeNull();
  });
});

describe("slotLengths", () => {
  it("is each slot's length by its clinic time", async () => {
    const { slotLengths } = await import("@/components/front-desk/slot-adapter");
    const lengths = slotLengths(
      [
        { start: "2026-12-01T04:30:00.000Z", end: "2026-12-01T05:00:00.000Z" },
        { start: "2026-12-01T05:00:00.000Z", end: "2026-12-01T05:15:00.000Z" },
      ],
      IST,
    );
    expect([...lengths]).toEqual([["10:00", 30], ["10:30", 15]]);
  });
});
