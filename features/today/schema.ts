/**
 * Today board model (V2-08 08-03a; 06-UI-SPEC §7; the `003-today` prototype): the row the front desk sees, the five lanes,
 * and the pure rules the screen uses (which lane a visit is in, the filter box, the optimistic check-in). Client-safe: no
 * server-only import, so the board component, its unit specs and the read model share one definition.
 */
import type { RowAction } from "@/features/visits/state-machine";
import type { VitalsReading } from "@/lib/clinical/vitals";
import type { VisitStatus } from "@/lib/db/types";

export const TODAY_LANE_IDS = ["booked", "waiting", "with_doctor", "to_bill", "done"] as const;
export type TodayLaneId = (typeof TODAY_LANE_IDS)[number];

export interface TodayLane {
  id: TodayLaneId;
  /** The lane head and the screen-reader name. */
  label: string;
  /** The lane switch segment ("Booked · Waiting · Doctor · Bill · Done", 06-UI-SPEC §7). */
  short: string;
  /** Empty-lane copy (06-UI-SPEC "Empty lanes"). */
  empty: string;
  /** The caption at the right of the lane head, where the prototype has one. */
  note?: string;
}

export const TODAY_LANES: readonly TodayLane[] = [
  { id: "booked", label: "Booked", short: "Booked", empty: "No more appointments today", note: "not arrived" },
  { id: "waiting", label: "Waiting", short: "Waiting", empty: "Nobody waiting" },
  { id: "with_doctor", label: "With doctor", short: "Doctor", empty: "No one with a doctor" },
  { id: "to_bill", label: "To bill", short: "Bill", empty: "Nothing to collect" },
  { id: "done", label: "Done", short: "Done", empty: "No finished visits yet" },
];

export type TodayPriority = "normal" | "urgent" | "vip";

/** One visit of the clinic day, as Today shows it. Everything a role may not see is `null`; nothing here is free text. */
export interface TodayRow {
  visitId: string;
  patientId: string;
  name: string;
  /** `42 y`, `8 m`; null when neither a date of birth nor an age is on file. */
  age: string | null;
  /** `M`, `F`, `O`. */
  sex: string | null;
  /** The patient's mobile as stored (`+91...`); used for the filter box and the detail's call link. */
  phone: string | null;
  status: VisitStatus;
  signed: boolean;
  token: number | null;
  priority: TodayPriority | null;
  /** The appointment's clinic wall-clock time `HH:mm`; null for a walk-in. */
  time: string | null;
  origin: "walk_in" | "scheduled";
  overbooked: boolean;
  doctorId: string;
  doctorName: string;
  /** The clinic wall-clock time `HH:mm` the visit was checked in (its token was issued); null when it has no token. */
  arrivedAt: string | null;
  /** Minutes since check-in as of `TodayBoard.generatedAt` (the client adds the time since it received the board); null when not waiting. */
  waitMinutes: number | null;
  /** True/false for a role that may see allergies (`vitals:view` or `consultations:view`), else null. */
  hasAllergy: boolean | null;
  /** The recorded vitals for a role that may read them; null when none are recorded or the role may not read them. */
  vitals: VitalsReading | null;
  /** True when the role reads vitals and none are recorded yet ("Vitals pending"). */
  vitalsPending: boolean;
  /** Money still due on a completed visit, in rupees; null for a role without `billing:view`. */
  balanceDue: number | null;
  /** The row actions the caller's role may use now (state machine, R-7). */
  actions: RowAction[];
}

export const TODAY_ROW_KEYS = [
  "actions",
  "age",
  "arrivedAt",
  "balanceDue",
  "doctorId",
  "doctorName",
  "hasAllergy",
  "name",
  "origin",
  "overbooked",
  "patientId",
  "phone",
  "priority",
  "sex",
  "signed",
  "status",
  "time",
  "token",
  "visitId",
  "vitals",
  "vitalsPending",
  "waitMinutes",
] as const;

export interface TodayBoard {
  rows: TodayRow[];
  /** ISO instant the board was read (server clock). */
  generatedAt: string;
  /** Clinic date `YYYY-MM-DD` and zone. */
  today: string;
  timeZone: string;
}

/** The lane of a visit. No-show and cancelled sit in Done with their own chip (as in the prototype). */
export function laneOf(row: Pick<TodayRow, "status" | "balanceDue">): TodayLaneId {
  switch (row.status) {
    case "booked":
    case "confirmed":
      return "booked";
    case "waiting":
      return "waiting";
    case "in_consultation":
      return "with_doctor";
    case "completed":
      return row.balanceDue != null && row.balanceDue > 0 ? "to_bill" : "done";
    default:
      return "done";
  }
}

const PRIORITY_RANK: Record<TodayPriority, number> = { urgent: 0, vip: 1, normal: 2 };

/** Lane order: booked by appointment time; waiting urgent first, then by token; the rest by token. */
function compareInLane(lane: TodayLaneId): (a: TodayRow, b: TodayRow) => number {
  const byToken = (a: TodayRow, b: TodayRow) => (a.token ?? 1e9) - (b.token ?? 1e9);
  const byName = (a: TodayRow, b: TodayRow) => a.name.localeCompare(b.name);
  if (lane === "booked") return (a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || byName(a, b);
  if (lane === "waiting")
    return (a, b) => PRIORITY_RANK[a.priority ?? "normal"] - PRIORITY_RANK[b.priority ?? "normal"] || byToken(a, b) || byName(a, b);
  if (lane === "done") return (a, b) => byToken(b, a) || byName(a, b);
  return (a, b) => byToken(a, b) || byName(a, b);
}

export type TodayLanes = Record<TodayLaneId, TodayRow[]>;

/** Rows grouped into the five lanes, each in its own order. */
export function groupIntoLanes(rows: readonly TodayRow[]): TodayLanes {
  const lanes: TodayLanes = { booked: [], waiting: [], with_doctor: [], to_bill: [], done: [] };
  for (const row of rows) lanes[laneOf(row)].push(row);
  for (const id of TODAY_LANE_IDS) lanes[id].sort(compareInLane(id));
  return lanes;
}

const digitsOf = (text: string) => text.replace(/\D/g, "");

/**
 * The filter box "Token, name or mobile" (client-side). One to three digits are a token; four or more digits are a
 * mobile number fragment; anything else matches every word against the name. An empty query matches everything.
 */
export function matchesQuery(row: Pick<TodayRow, "token" | "name" | "phone">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = digitsOf(q);
  const onlyDigits = digits.length > 0 && digits.length === q.replace(/[\s+()-]/g, "").length;
  if (onlyDigits && digits.length <= 3) return row.token === Number(digits);
  if (onlyDigits) return digitsOf(row.phone ?? "").includes(digits.slice(-10));
  const name = row.name.toLowerCase();
  return q.split(/\s+/).every((part) => name.includes(part));
}

/** What the client shows for a check-in it has sent and the server has not yet confirmed. */
export interface PendingCheckIn {
  visitId: string;
  /** The status the row had when the check-in was sent; the override applies only while the server row still has it. */
  from: VisitStatus;
}

/** Applies the checked-in rows the server has not caught up with yet (the optimistic move to Waiting). */
export function withPendingCheckIns(rows: readonly TodayRow[], pending: readonly PendingCheckIn[]): TodayRow[] {
  if (pending.length === 0) return rows as TodayRow[];
  const byId = new Map(pending.map((p) => [p.visitId, p]));
  return rows.map((row) => {
    const p = byId.get(row.visitId);
    if (!p || row.status !== p.from) return row;
    return {
      ...row,
      status: "waiting",
      waitMinutes: 0,
      actions: row.actions.filter((a) => a !== "check_in" && a !== "reschedule" && a !== "no_show"),
    };
  });
}

/** The wait of a waiting row now: the board's minutes plus the time since the browser received it. */
export function waitNow(row: Pick<TodayRow, "waitMinutes">, receivedAtMs: number, nowMs: number): number | null {
  if (row.waitMinutes == null) return null;
  return row.waitMinutes + Math.max(0, Math.floor((nowMs - receivedAtMs) / 60_000));
}

const RUPEES = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** `₹1,250` (paise only when non-zero, DESIGN_SYSTEM §5). */
export function formatRupees(amount: number): string {
  return `₹${RUPEES.format(amount)}`;
}
