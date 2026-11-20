/**
 * V2-08 08-03a (06-UI-SPEC §8 "Live data"): Today's polite announcements are composed from the refreshed rows and leave at
 * most once per 5 s, batched. Fake clock.
 */
import { describe, expect, it } from "vitest";
import { ANNOUNCE_INTERVAL_MS, announcementsFor, createAnnouncer } from "@/components/today/announcer";
import type { TodayRow } from "@/features/today/schema";

function row(over: Partial<TodayRow>): TodayRow {
  return {
    visitId: "v1",
    patientId: "p1",
    name: "Ramesh Kumar",
    age: "42 y",
    sex: "M",
    phone: "+919000000001",
    status: "booked",
    signed: false,
    token: null,
    priority: null,
    time: "10:30",
    origin: "scheduled",
    overbooked: false,
    doctorId: "d1",
    doctorName: "Dr A Rao",
    arrivedAt: null,
    waitMinutes: null,
    hasAllergy: null,
    vitals: null,
    vitalsPending: false,
    balanceDue: null,
    actions: [],
    ...over,
  };
}

describe("announcementsFor", () => {
  it("composes 'Token 14, Ramesh Kumar, checked in' from the rows, not from a signal", () => {
    const before = [row({ status: "booked" })];
    const after = [row({ status: "waiting", token: 14 })];
    expect(announcementsFor(before, after)).toEqual(["Token 14, Ramesh Kumar, checked in"]);
  });

  it("says nothing for an unchanged row, a first load or a status without a sentence", () => {
    const rows = [row({ status: "waiting", token: 3 })];
    expect(announcementsFor(rows, rows)).toEqual([]);
    expect(announcementsFor([], rows)).toEqual(["Token 3, Ramesh Kumar, added to the queue"]);
    expect(announcementsFor([row({ status: "booked" })], [row({ status: "confirmed" })])).toEqual([]);
  });

  it("names the other moves", () => {
    const base = row({ status: "waiting", token: 5 });
    expect(announcementsFor([base], [{ ...base, status: "in_consultation" }])).toEqual(["Token 5, Ramesh Kumar, with the doctor"]);
    expect(announcementsFor([base], [{ ...base, status: "cancelled" }])).toEqual(["Token 5, Ramesh Kumar, cancelled"]);
  });
});

describe("createAnnouncer", () => {
  function fake() {
    let now = 1_000_000;
    let pending: { at: number; fn: () => void } | null = null;
    const emitted: string[] = [];
    const announcer = createAnnouncer({
      now: () => now,
      schedule: (fn, ms) => {
        pending = { at: now + ms, fn };
        return () => {
          pending = null;
        };
      },
      emit: (m) => emitted.push(m),
    });
    return {
      announcer,
      emitted,
      advance(ms: number) {
        now += ms;
        if (pending && pending.at <= now) {
          const p = pending;
          pending = null;
          p.fn();
        }
      },
    };
  }

  it("the first message goes out at once; later ones within 5 s wait and are joined into one", () => {
    const f = fake();
    f.announcer.push(["Token 1, A, checked in"]);
    expect(f.emitted).toEqual(["Token 1, A, checked in"]);
    f.announcer.push(["Token 2, B, checked in"]);
    f.advance(1_000);
    f.announcer.push(["Token 3, C, checked in"]);
    expect(f.emitted).toHaveLength(1);
    f.advance(ANNOUNCE_INTERVAL_MS - 1_000);
    expect(f.emitted).toEqual(["Token 1, A, checked in", "2 changes: Token 2, B, checked in; Token 3, C, checked in"]);
  });

  it("never more than one message per interval", () => {
    const f = fake();
    for (let i = 0; i < 6; i++) {
      f.announcer.push([`m${i}`]);
      f.advance(1_000);
    }
    f.advance(ANNOUNCE_INTERVAL_MS);
    expect(f.emitted.length).toBeLessThanOrEqual(3);
    expect(f.emitted.join(" ")).toContain("m5");
  });

  it("stop drops what is queued", () => {
    const f = fake();
    f.announcer.push(["a"]);
    f.announcer.push(["b"]);
    f.announcer.stop();
    f.advance(ANNOUNCE_INTERVAL_MS * 2);
    expect(f.emitted).toEqual(["a"]);
  });
});
