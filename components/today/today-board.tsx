"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { buttonClassName } from "@/components/ui/button";
import { ResponsiveSheet, ResponsiveSheetBody, ResponsiveSheetContent, ResponsiveSheetHeader } from "@/components/ui/responsive-sheet";
import { registerHref } from "@/components/front-desk/patient-search";
import {
  groupIntoLanes,
  lanesOf,
  matchesQuery,
  nextUp,
  withPendingCheckIns,
  type PendingCheckIn,
  type TodayBoard,
  type TodayLaneId,
  type TodayMode,
  type TodayRow,
} from "@/features/today/schema";
import { createAnnouncer, announcementsFor, type Announcer } from "./announcer";
import { toCheckoutTarget } from "./checkout-target";
import { Lane } from "./lane";
import { NextPatientCard } from "./next-patient-card";
import { PatientSnapshotPanel, type SnapshotPanelData } from "./patient-snapshot-panel";
import { OpenAmendments } from "./open-amendments";
import type { OpenAmendment } from "@/features/today/queries";
import { TodayHead } from "./today-head";
import { TodayRowView } from "./today-row";
import { useTodayLive } from "./use-today-live";
import { VisitDetail } from "./visit-detail";

/**
 * The Today board (V2-08 08-03a; 06-UI-SPEC §7; `003-today`): the front desk's day in five lanes.
 * - below 768 px: a lane switch (Booked · Waiting · Doctor · Bill · Done, with counts), one lane at a time, a row tap opens
 *   the visit in the bottom drawer;
 * - 768 to 1279 px: two panes (the lane switch and one lane on the left, `minmax(320px, 44%)`, the selected visit on the
 *   right), each scrolling on its own inside `100dvh` minus the bar;
 * - 1280 px and up: Booked, Waiting, With doctor and To bill side by side and Done as a column that expands; a row tap opens
 *   the visit in the side sheet.
 * Modes (V2-08 08-03b, R-14): the front desk's day, the nurse's triage view (Waiting with vitals pending first, Record
 * vitals as the action) and the doctor's own queue (the pinned "Next" card, lanes Waiting (mine), With me and Seen today). Row
 * actions come from the state machine (`rowButtons`); Record vitals opens the vitals sheet and Collect the checkout drawer.
 * The filter box matches token, name or mobile over the loaded rows; while it is in use every lane with a match stacks. The
 * selection lives in `?visit=`. Live updates (`useTodayLive`) refresh the server rows; the check-in the user sends moves a
 * row to Waiting at once (`withPendingCheckIns`) and the server's rows replace it when they arrive. Changes are announced
 * to screen readers from the refreshed rows, at most one polite message per 5 s.
 */
// The checkout drawer (a large v1 component) and the vitals sheet are needed only once a row asks for them: their code loads
// then, not with the board (the route's first-load JS, `npm run ci:route-js`).
const CheckoutDrawer = dynamic(() => import("@/components/queue/checkout-drawer").then((m) => m.CheckoutDrawer), { ssr: false });
const VitalsSheet = dynamic(() => import("./vitals-sheet").then((m) => m.VitalsSheet), { ssr: false });

/** The current address with one sheet parameter added (R-13). */
function sheetHref(pathname: string, params: { toString(): string }, key: "walkin" | "new"): string {
  const next = new URLSearchParams(params.toString());
  next.set(key, "1");
  return `${pathname}?${next.toString()}`;
}

const TWO_PANE = "(min-width: 768px) and (max-width: 1279.98px)";

function useTwoPane(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(TWO_PANE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(TWO_PANE).matches,
    () => false,
  );
}

export interface TodayBoardViewProps {
  board: TodayBoard;
  tenantId: string;
  canRegister: boolean;
  canWalkIn: boolean;
  /** The role holds `consultations:edit` (Call in, Start consultation, Open consult). */
  canConsult: boolean;
  mode: TodayMode;
  /** The modes the role may open (an owner has two). */
  modes: readonly TodayMode[];
  /** "Fri, 13 Nov 2026 · clinic time (IST)". */
  dateLine: string;
  /** Doctor mode (V2-09b 09B-04a): the snapshot of the patient the server saw as Next (`assist.snapshot`), shown beside the Next card at 768 px and up. */
  snapshotPanel?: SnapshotPanelData | null;
  /** Doctor mode: the doctor's own signed visits that are reopened and not finalized. */
  openAmendments?: readonly OpenAmendment[];
}

export function TodayBoardView({ board, tenantId, canRegister, canWalkIn, canConsult, mode, modes, dateLine, snapshotPanel = null, openAmendments = [] }: TodayBoardViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const live = useTodayLive(tenantId);
  const twoPane = useTwoPane();

  const [query, setQuery] = useState("");
  const [doctorId, setDoctorId] = useState("all");
  const [laneId, setLaneId] = useState<TodayLaneId>("waiting");
  const [doneOpen, setDoneOpen] = useState(false);
  const [pending, setPending] = useState<PendingCheckIn[]>([]);
  const [message, setMessage] = useState("");
  const [vitalsRow, setVitalsRow] = useState<TodayRow | null>(null);
  const [collectRow, setCollectRow] = useState<TodayRow | null>(null);

  const rows = useMemo(() => withPendingCheckIns(board.rows, pending), [board.rows, pending]);

  // Rows whose status changed in a refresh flash once: a counter per visit, updated while rendering (derived state).
  const [seen, setSeen] = useState<{ rows: TodayRow[]; flash: Record<string, number> }>({ rows: board.rows, flash: {} });
  if (seen.rows !== board.rows) {
    const before = new Map(seen.rows.map((r) => [r.visitId, r.status]));
    const flash = { ...seen.flash };
    for (const r of board.rows) if (before.has(r.visitId) && before.get(r.visitId) !== r.status) flash[r.visitId] = (flash[r.visitId] ?? 0) + 1;
    setSeen({ rows: board.rows, flash });
  }

  // The polite live region: one message at most every 5 s, composed from the refreshed rows.
  const announcer = useRef<Announcer | null>(null);
  const previous = useRef(board.rows);
  useEffect(() => {
    announcer.current = createAnnouncer({
      now: () => Date.now(),
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      emit: setMessage,
    });
    return () => announcer.current?.stop();
  }, []);
  useEffect(() => {
    announcer.current?.push(announcementsFor(previous.current, board.rows));
    previous.current = board.rows;
  }, [board.rows]);

  // The wait ticks every 30 s from the moment this board was received (the board holds minutes as of the server clock).
  const [clock, setClock] = useState<{ received: number; now: number } | null>(null);
  useEffect(() => {
    const received = Date.now();
    const first = setTimeout(() => setClock({ received, now: received }), 0);
    const tick = setInterval(() => setClock({ received, now: Date.now() }), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, [board.generatedAt]);

  const doctors = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of board.rows) byId.set(r.doctorId, r.doctorName);
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [board.rows]);

  const forDoctor = useMemo(() => (doctorId === "all" ? rows : rows.filter((r) => r.doctorId === doctorId)), [rows, doctorId]);
  const laneDefs = useMemo(() => lanesOf(mode), [mode]);
  const counts = useMemo(() => groupIntoLanes(forDoctor, mode), [forDoctor, mode]);
  const filtering = query.trim().length > 0;
  const lanes = useMemo(() => groupIntoLanes(filtering ? forDoctor.filter((r) => matchesQuery(r, query)) : forDoctor, mode), [forDoctor, filtering, query, mode]);
  const matchCount = laneDefs.reduce((n, l) => n + lanes[l.id].length, 0);

  const selectedId = params.get("visit");
  const selectedRow = rows.find((r) => r.visitId === selectedId) ?? null;
  // In the two-pane layout the detail is always on screen: the selected visit, or the first of the lane in view.
  const paneRow = selectedRow ?? lanes[laneId][0] ?? null;

  const select = (visitId: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (visitId) next.set("visit", visitId);
    else next.delete("visit");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const empty = board.rows.length === 0;
  const laneOptions = laneDefs.map((l) => ({ value: l.id, label: l.short, count: counts[l.id].length }));

  const handlers = {
    onOptimistic: (r: TodayRow) => setPending((p) => [...p.filter((x) => x.visitId !== r.visitId), { visitId: r.visitId, from: r.status }]),
    onRollback: (id: string) => setPending((p) => p.filter((x) => x.visitId !== id)),
    onChanged: live.refreshNow,
    onRecordVitals: setVitalsRow,
    onCollect: setCollectRow,
  };
  // The doctor's Next card carries the first waiting patient's Call in (not while a filter narrows the list).
  const next = mode === "doctor" && !filtering ? nextUp(lanes) : null;

  const rowView = (row: TodayRow) => (
    <TodayRowView
      key={row.visitId}
      row={row}
      mode={mode}
      canConsult={canConsult}
      next={next?.visitId === row.visitId}
      selected={(twoPane ? paneRow?.visitId : selectedId) === row.visitId}
      flashKey={seen.flash[row.visitId]}
      clock={clock}
      onOpen={select}
      {...handlers}
    />
  );

  return (
    <div data-today-board="" className="flex flex-col gap-3">
      <TodayHead
        dateLine={dateLine}
        live={live.state}
        query={query}
        onQueryChange={setQuery}
        doctors={doctors}
        doctorId={doctorId}
        onDoctorChange={setDoctorId}
        canRegister={canRegister}
        canWalkIn={canWalkIn}
        mode={mode}
        modes={modes}
      />
      <div role="status" aria-live="polite" data-today-announcer="" className="sr-only">
        {message}
      </div>

      {filtering && (
        <p role="status" className="text-body-sm text-fg-muted">
          {matchCount === 0 ? (
            <>
              No one in today&apos;s list matches “{query.trim()}”.{" "}
              {canRegister && (
                <Link href={registerHref(query, "/today")} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                  Register as new patient
                </Link>
              )}
            </>
          ) : (
            `${matchCount} ${matchCount === 1 ? "match" : "matches"}`
          )}
        </p>
      )}

      {mode === "doctor" && <OpenAmendments items={openAmendments} timeZone={board.timeZone} />}

      {next &&
        (snapshotPanel && snapshotPanel.patientId === next.patientId ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <NextPatientCard row={next} {...handlers} />
            <PatientSnapshotPanel name={next.name} data={snapshotPanel} />
          </div>
        ) : (
          <NextPatientCard row={next} {...handlers} />
        ))}

      {!filtering && !empty && (
        <div className="xl:hidden" data-lane-switch="">
          <SegmentedControl
            aria-label="Lane"
            block
            value={laneId}
            onValueChange={(value) => setLaneId(value as TodayLaneId)}
            options={laneOptions}
          />
        </div>
      )}

      {empty ? (
        <div data-today-empty="" className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
          <p className="text-body-md font-semibold text-fg">No patients yet today</p>
          <p className="mt-1 text-body-sm text-fg-muted">Walk-ins and check-ins appear here.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {canWalkIn && (
              <Link href={sheetHref(pathname, params, "walkin")} className={buttonClassName({ variant: "primary" })}>
                Add walk-in
              </Link>
            )}
            {canRegister && (
              <Link href={sheetHref(pathname, params, "new")} className={buttonClassName({ variant: "secondary" })}>
                Register patient
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div
          data-board=""
          className={
            "flex flex-col gap-3 md:grid md:h-[calc(100dvh-var(--spacing-bar)-13rem)] md:min-h-96 md:grid-cols-[minmax(320px,44%)_minmax(0,1fr)] md:gap-4 " +
            (laneDefs.length === 5
              ? doneOpen
                ? "xl:grid-cols-[repeat(5,minmax(0,1fr))] "
                : "xl:grid-cols-[repeat(4,minmax(0,1fr))_2.75rem] "
              : doneOpen
                ? "xl:grid-cols-[repeat(4,minmax(0,1fr))] "
                : "xl:grid-cols-[repeat(3,minmax(0,1fr))_2.75rem] ") +
            "xl:gap-3"
          }
        >
          <div className="flex flex-col gap-3 md:flex md:min-h-0 md:flex-col xl:contents">
            {laneDefs.map((lane) => (
              <Lane
                key={lane.id}
                lane={lane}
                count={filtering ? lanes[lane.id].length : counts[lane.id].length}
                shown={filtering ? lanes[lane.id].length > 0 : laneId === lane.id}
                collapsed={lane.id === "done" ? !doneOpen : false}
                onToggleCollapsed={lane.id === "done" ? () => setDoneOpen((open) => !open) : undefined}
              >
                {lanes[lane.id].map(rowView)}
              </Lane>
            ))}
          </div>
          <aside
            aria-label="Selected visit"
            data-detail-pane=""
            className="hidden min-h-0 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface md:block xl:hidden"
          >
            {twoPane && paneRow ? (
              <VisitDetail row={paneRow} />
            ) : (
              <p className="px-4 py-6 text-center text-body-sm text-fg-muted">Select a visit to see its details.</p>
            )}
          </aside>
        </div>
      )}

      {vitalsRow && <VitalsSheet row={vitalsRow} onOpenChange={(open) => !open && setVitalsRow(null)} onSaved={live.refreshNow} />}
      {collectRow && (
        <CheckoutDrawer isOpen onClose={() => setCollectRow(null)} onSuccess={live.refreshNow} queueItem={toCheckoutTarget(collectRow)} />
      )}

      <ResponsiveSheet open={!twoPane && selectedRow !== null} onOpenChange={(open) => !open && select(null)}>
        <ResponsiveSheetContent aria-describedby={undefined} data-today-detail-sheet="">
          <ResponsiveSheetHeader title={selectedRow?.name ?? "Visit"} />
          <ResponsiveSheetBody className="px-0 py-0">
            {selectedRow && <VisitDetail row={selectedRow} headingLevel={3} />}
          </ResponsiveSheetBody>
        </ResponsiveSheetContent>
      </ResponsiveSheet>
    </div>
  );
}
