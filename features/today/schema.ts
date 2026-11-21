/**
 * Today board model (V2-08 08-03a; 06-UI-SPEC §7; the `003-today` prototype): the row the front desk sees, the five lanes,
 * and the pure rules the screen uses (which lane a visit is in, the filter box, the optimistic check-in). Client-safe: no
 * server-only import, so the board component, its unit specs and the read model share one definition.
 */
import type { RowAction } from "@/features/visits/state-machine";
import type { VitalsReading } from "@/lib/clinical/vitals";
import type { UserRole, VisitStatus } from "@/lib/db/types";

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

/**
 * The three Today modes (R-14): the front desk's day, the nurse's triage view (Waiting with vitals pending first, Record
 * vitals as the action) and the doctor's own queue. A role may use only some of them; an owner toggles front and doctor.
 */
export const TODAY_MODES = ["front", "triage", "doctor"] as const;
export type TodayMode = (typeof TODAY_MODES)[number];

const MODES_OF_ROLE: Record<UserRole, readonly TodayMode[]> = {
  owner: ["front", "doctor"],
  admin: ["front"],
  receptionist: ["front"],
  nurse: ["triage"],
  doctor: ["doctor"],
};

/** The modes a role may open; the first is its default. */
export function modesOf(role: UserRole): readonly TodayMode[] {
  return MODES_OF_ROLE[role] ?? ["front"];
}

/** `?mode=` resolved for a role: the requested mode when the role may use it, else the role's default. */
export function resolveMode(role: UserRole, requested: string | null | undefined): TodayMode {
  const modes = modesOf(role);
  return modes.find((m) => m === requested) ?? modes[0]!;
}

/** The lanes a mode shows. The doctor's board folds To bill into "Seen today" (a doctor does not collect) and says "mine". */
export function lanesOf(mode: TodayMode): readonly TodayLane[] {
  if (mode !== "doctor") return TODAY_LANES;
  return [
    TODAY_LANES[0]!,
    { ...TODAY_LANES[1]!, label: "Waiting (mine)", short: "Waiting" },
    { ...TODAY_LANES[2]!, label: "With me", short: "With me", empty: "No one with you" },
    { ...TODAY_LANES[4]!, label: "Seen today", short: "Seen", empty: "No one seen yet" },
  ];
}

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
  /**
   * Whether the visit has a live (not cancelled) invoice: `false` on a completed visit nobody has billed yet (the doctor signed
   * without "sign and bill"), which belongs in To bill as "Not billed" (V2-08 08-06a, A-4). Null for a role without
   * `billing:view` and for a visit that is not completed.
   */
  billed: boolean | null;
  /** The row actions the caller's role may use now (state machine, R-7). */
  actions: RowAction[];
}

export const TODAY_ROW_KEYS = [
  "actions",
  "age",
  "arrivedAt",
  "balanceDue",
  "billed",
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

/** The lane of a visit. Cancelled and (past check-in) no-show visits sit in Done with their own chip (as in the prototype). */
export function laneOf(
  row: Pick<TodayRow, "status" | "balanceDue"> & Partial<Pick<TodayRow, "billed" | "actions">>,
  mode: TodayMode = "front",
): TodayLaneId {
  switch (row.status) {
    case "booked":
    case "confirmed":
      return "booked";
    case "no_show":
      // A late arrival can still be checked in (R-8): while "Check in" is offered the row stays where the desk looks for
      // arrivals, in Booked, instead of the collapsed Done column (V2-08 08-06a, A-10). Without it (other days, roles that
      // cannot check in) it is Done as before.
      return row.actions?.includes("check_in") ? "booked" : "done";
    case "waiting":
      return "waiting";
    case "in_consultation":
      return "with_doctor";
    case "completed":
      // To bill: money still due, or no invoice at all (a completed visit that was signed without "sign and bill", A-4).
      return mode !== "doctor" && ((row.balanceDue != null && row.balanceDue > 0) || row.billed === false) ? "to_bill" : "done";
    default:
      return "done";
  }
}

/**
 * The amount the status chip is given: a completed visit without an invoice reads as "To bill" like one with a balance
 * (`displayVisitStatus` looks only at the sign of the amount).
 */
export function chipBalance(row: Pick<TodayRow, "balanceDue" | "billed">): number | null {
  return row.billed === false ? 1 : row.balanceDue;
}

const PRIORITY_RANK: Record<TodayPriority, number> = { urgent: 0, vip: 1, normal: 2 };

/** Lane order: booked by appointment time; waiting urgent first, then by token; the rest by token. */
function compareInLane(lane: TodayLaneId, mode: TodayMode): (a: TodayRow, b: TodayRow) => number {
  const byToken = (a: TodayRow, b: TodayRow) => (a.token ?? 1e9) - (b.token ?? 1e9);
  const byName = (a: TodayRow, b: TodayRow) => a.name.localeCompare(b.name);
  if (lane === "booked") return (a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || byName(a, b);
  if (lane === "waiting") {
    // Triage: the people whose vitals are still to be taken come first (a nurse's work list).
    const pending = (r: TodayRow) => (mode === "triage" && r.vitalsPending ? 0 : 1);
    return (a, b) =>
      pending(a) - pending(b) ||
      PRIORITY_RANK[a.priority ?? "normal"] - PRIORITY_RANK[b.priority ?? "normal"] ||
      byToken(a, b) ||
      byName(a, b);
  }
  if (lane === "done") return (a, b) => byToken(b, a) || byName(a, b);
  return (a, b) => byToken(a, b) || byName(a, b);
}

export type TodayLanes = Record<TodayLaneId, TodayRow[]>;

/** Rows grouped into the five lanes, each in its own order (the doctor's mode has no To bill lane). */
export function groupIntoLanes(rows: readonly TodayRow[], mode: TodayMode = "front"): TodayLanes {
  const lanes: TodayLanes = { booked: [], waiting: [], with_doctor: [], to_bill: [], done: [] };
  for (const row of rows) lanes[laneOf(row, mode)].push(row);
  for (const id of TODAY_LANE_IDS) lanes[id].sort(compareInLane(id, mode));
  return lanes;
}

/** A button on a Today row: what it does and whether it is the row's primary action. */
export interface RowButton {
  kind: "check_in" | "start" | "open_consult" | "record_vitals" | "collect";
  primary: boolean;
}

/**
 * The buttons a row shows in a mode, from the state machine's `actions` for the caller's role (R-7, `rowActions`) and
 * `canConsult` (the role holds `consultations:edit`). Front: Check in and Collect. Triage: Record vitals first, then
 * Check in. Doctor: Start consultation / Call in (a booked, confirmed or no-show visit is checked in first, R-1), Open
 * consult for a visit already with the doctor, and Record vitals. Move, No-show and Cancel are the ⋯ menu
 * of the row (`rowMenuItems`, 08-04b), not buttons. Nobody is offered an action the state machine did not list.
 */
export function rowButtons(
  mode: TodayMode,
  row: Pick<TodayRow, "status" | "actions">,
  canConsult: boolean,
): RowButton[] {
  const has = (a: RowAction) => row.actions.includes(a);
  const out: RowButton[] = [];
  if (mode === "doctor") {
    if (has("start")) out.push({ kind: "start", primary: true });
    else if (canConsult && row.status === "in_consultation") out.push({ kind: "open_consult", primary: true });
    if (has("record_vitals")) out.push({ kind: "record_vitals", primary: false });
    return out;
  }
  if (mode === "triage") {
    if (has("record_vitals")) out.push({ kind: "record_vitals", primary: true });
    if (has("check_in")) out.push({ kind: "check_in", primary: !has("record_vitals") });
    return out;
  }
  if (has("check_in")) out.push({ kind: "check_in", primary: true });
  if (has("collect")) out.push({ kind: "collect", primary: !has("check_in") });
  return out;
}

/** The doctor's next patient: the first of the Waiting (mine) lane. */
export function nextUp(lanes: TodayLanes): TodayRow | null {
  return lanes.waiting[0] ?? null;
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
