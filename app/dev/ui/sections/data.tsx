"use client";

/**
 * Gallery section: data display (V2-06 06-02c, P1-28 M2 2c; 06-UI-SPEC "06-02c Data display and dates",
 * DESIGN_SYSTEM §6.6-§6.11). One column model drawn as a DataTable from 1024 px and a DataList below; search, filters,
 * pagination, skeletons, empty states, alerts and banners. Synthetic copy only ("Synthetic Patient 01"). The keyboard
 * spec (tests/e2e/design/keyboard/data-and-dates.spec.ts) drives the live specimens and reads what they report.
 */
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, Clock, Ellipsis, SearchX, Users, WifiOff } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { DataColumn, DataSort } from "@/components/ui/data-table";
import { DataView } from "@/components/ui/data-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, type AppliedFilter } from "@/components/ui/filter-chip";
import { IconButton } from "@/components/ui/icon-button";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { formatClinicDate } from "@/lib/datetime/format";
import { GalleryGroup, GallerySection, Specimen } from "../kit";

interface PatientRow {
  id: string;
  name: string;
  mobile: string;
  age: string;
  status: string;
  lastVisit: string;
  visits: number;
}

const BASE_ROWS: PatientRow[] = [
  { id: "p01", name: "Synthetic Patient 01", mobile: "+91 ••••• •3210", age: "42 y · M", status: "Waiting", lastVisit: "2026-11-12", visits: 14 },
  { id: "p02", name: "Synthetic Patient 02", mobile: "+91 ••••• •4821", age: "8 m · F", status: "With doctor", lastVisit: "2026-11-10", visits: 3 },
  { id: "p03", name: "Synthetic Patient 03 with a much longer full name", mobile: "+91 ••••• •0917", age: "67 y · F", status: "Done", lastVisit: "2026-10-28", visits: 31 },
  { id: "p04", name: "Synthetic Patient 04", mobile: "+91 ••••• •5532", age: "29 y · O", status: "To bill", lastVisit: "2026-11-11", visits: 1 },
  { id: "p05", name: "Synthetic Patient 05", mobile: "+91 ••••• •7604", age: "12 d · M", status: "Booked", lastVisit: "2026-09-30", visits: 2 },
];

const MORE_ROWS: PatientRow[] = [
  { id: "p06", name: "Synthetic Patient 06", mobile: "+91 ••••• •1188", age: "55 y · M", status: "Done", lastVisit: "2026-08-14", visits: 9 },
  { id: "p07", name: "Synthetic Patient 07", mobile: "+91 ••••• •6402", age: "3 y · F", status: "Done", lastVisit: "2026-07-02", visits: 6 },
];

type TableState = "ready" | "loading" | "empty" | "error" | "stale";

/** What a live specimen did last, for the keyboard spec to read. */
function Outcome({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p data-testid={id} role="status" className="min-h-5 text-label tabular-nums text-fg-muted">
      {children}
    </p>
  );
}

function sortRows(rows: readonly PatientRow[], sort: DataSort | null): PatientRow[] {
  if (!sort) return [...rows];
  const factor = sort.direction === "ascending" ? 1 : -1;
  const key = sort.column as keyof PatientRow;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * factor;
  });
}

const COLUMNS: DataColumn<PatientRow>[] = [
  {
    id: "name",
    header: "Patient",
    sortable: true,
    list: "title",
    cell: (row) => (
      <Link href={`/dev/ui#${row.id}`} className="font-medium text-fg underline-offset-2 hover:text-accent-fg hover:underline">
        {row.name}
      </Link>
    ),
    className: "min-w-56",
  },
  { id: "status", header: "Status", list: "status", cell: (row) => <span className="text-fg-secondary">{row.status}</span> },
  { id: "age", header: "Age", cell: (row) => row.age },
  { id: "mobile", header: "Mobile", cell: (row) => row.mobile },
  { id: "lastVisit", header: "Last visit", sortable: true, cell: (row) => formatClinicDate(row.lastVisit) },
  { id: "visits", header: "Visits", sortable: true, numeric: true, cell: (row) => row.visits },
];

function RowActions({ row }: { row: PatientRow }) {
  return (
    <>
      <Button variant="secondary" size="sm" aria-label={`Check in ${row.name}`}>
        Check in
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`More actions for ${row.name}`} icon={<Ellipsis />} size="sm" tooltip={false} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem>View profile</DropdownMenuItem>
          <DropdownMenuItem>Edit details</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

const ALL_FILTERS: AppliedFilter[] = [
  { id: "doctor", label: "Doctor", value: "Dr Rao" },
  { id: "status", label: "Status", value: "Waiting" },
  { id: "origin", label: "Visit", value: "Walk-in" },
];

export function DataSection() {
  const [tableState, setTableState] = useState<TableState>("ready");
  const [sort, setSort] = useState<DataSort | null>({ column: "lastVisit", direction: "descending" });
  const [extra, setExtra] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<{ query: string; count: number }>({ query: "", count: 0 });
  const [filters, setFilters] = useState<AppliedFilter[]>(ALL_FILTERS);
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [retries, setRetries] = useState(0);

  const rows = useMemo(() => {
    const all = extra ? [...BASE_ROWS, ...MORE_ROWS] : BASE_ROWS;
    const q = searched.query.trim().toLowerCase();
    return sortRows(q ? all.filter((row) => row.name.toLowerCase().includes(q)) : all, sort);
  }, [extra, searched.query, sort]);

  const viewState = tableState === "loading" ? "loading" : tableState === "error" ? "error" : "ready";
  const retry = () => {
    setRetries((n) => n + 1);
    setTableState("ready");
  };

  return (
    <GallerySection
      id="data"
      title="Data display"
      intro="One column model: a table from 1024 px, a two-line list below. Search, filters, pagination, loading, empty, error and stale states; alerts and banners."
    >
      <GalleryGroup
        id="search-filters"
        title="SearchField and FilterChip"
        note="Escape or Clear search empties the field; the search runs 200 ms after typing stops. Removing a filter moves focus to the next one."
        className="flex-col items-stretch"
      >
        <div className="flex w-full max-w-xl flex-col gap-1">
          <SearchField
            aria-label="Search patients"
            placeholder="Name, mobile or token"
            value={query}
            onValueChange={setQuery}
            onSearch={(q) => setSearched((s) => ({ query: q, count: s.count + 1 }))}
          />
          <Outcome id="search-outcome">
            {searched.count === 0 ? "No search yet" : `Searched “${searched.query}” · ${searched.count} ${searched.count === 1 ? "search" : "searches"}`}
          </Outcome>
        </div>
        <FilterBar
          label="Patient filters"
          filters={filters}
          onRemove={(id) => setFilters((list) => list.filter((f) => f.id !== id))}
          onClearAll={() => setFilters([])}
          addFilterOpen={addOpen}
          onAddFilterOpenChange={setAddOpen}
          addFilter={
            <div className="flex flex-col items-start gap-1">
              {ALL_FILTERS.filter((f) => !filters.some((g) => g.id === f.id)).map((f) => (
                <Button
                  key={f.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters((list) => [...list, f]);
                    setAddOpen(false);
                  }}
                >
                  {f.label}: {f.value}
                </Button>
              ))}
              {filters.length === ALL_FILTERS.length && <p className="px-2 text-body-sm text-fg-muted">Every filter is applied.</p>}
            </div>
          }
        />
        <Outcome id="filters-outcome">{filters.map((f) => f.id).join(", ") || "no filters"}</Outcome>
      </GalleryGroup>

      <GalleryGroup
        id="data-view"
        title="DataTable and DataList"
        note="Sortable headers are buttons with aria-sort. Row actions are always visible. The list shows Load more, never infinite scroll."
        className="flex-col items-stretch"
      >
        <SegmentedControl
          aria-label="Table state"
          value={tableState}
          onValueChange={(next) => setTableState(next as TableState)}
          options={[
            { value: "ready", label: "Ready" },
            { value: "loading", label: "Loading" },
            { value: "empty", label: "Empty" },
            { value: "error", label: "Error" },
            { value: "stale", label: "Stale" },
          ]}
        />
        <DataView
          label="Patients"
          columns={COLUMNS}
          rows={tableState === "empty" ? [] : rows}
          rowKey={(row) => row.id}
          actions={(row) => <RowActions row={row} />}
          sort={sort}
          onSortChange={setSort}
          state={viewState}
          error={{ message: "Couldn't load patients. Check the connection and try again.", onRetry: retry }}
          stale={tableState === "stale" ? { since: "10:42 am", onRetry: retry } : null}
          empty={
            <EmptyState
              icon={<SearchX />}
              title="Nothing matches these filters"
              description="Try another name or remove a filter."
              action={
                <Button variant="secondary" size="sm" onClick={() => setTableState("ready")}>
                  Clear filters
                </Button>
              }
            />
          }
          hasMore={!extra}
          loadingMore={loadingMore}
          onLoadMore={() => {
            setLoadingMore(true);
            setTimeout(() => {
              setExtra(true);
              setLoadingMore(false);
            }, 300);
          }}
        />
        <Outcome id="table-outcome">
          {sort ? `Sorted by ${sort.column} ${sort.direction}` : "Unsorted"} · {rows.length} rows · {retries} retries
        </Outcome>
      </GalleryGroup>

      <GalleryGroup id="pagination" title="Pagination" note="Previous is disabled on the first page, Next on the last.">
        <Specimen label="Page in state" state="default" className="w-full max-w-xl">
          <Pagination page={page} pageSize={25} total={1240} onPageChange={setPage} label="Patients pages" />
          <Outcome id="pagination-outcome">Page {page}</Outcome>
        </Specimen>
        <Specimen label="Last page" state="disabled" className="w-full max-w-xl">
          <Pagination page={2} pageSize={25} total={48} onPageChange={() => {}} label="Short list pages" />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="skeleton" title="Skeleton" note="Static blocks in the border fill; they pulse only when motion is allowed. Real titles show at once.">
        <Specimen label="Queue row loading" state="loading" className="w-full max-w-sm">
          <SkeletonRegion label="Loading queue" className="flex w-full flex-col gap-3 rounded-md border border-border p-3">
            <p className="text-title-3 font-semibold text-fg">Waiting</p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-7 w-9 rounded-sm" />
                <div className="flex grow flex-col gap-1.5">
                  <Skeleton shape="text" className="h-3.5 w-40" />
                  <Skeleton shape="text" className="w-24" />
                </div>
                <Skeleton className="h-7 w-16 rounded-sm" />
              </div>
            ))}
          </SkeletonRegion>
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="empty-state" title="EmptyState" note="One icon, a specific title, one sentence, one primary action.">
        <Specimen label="Today, no patients" state="empty" className="w-full max-w-sm rounded-md border border-border">
          <EmptyState
            icon={<Users />}
            title="No patients yet today"
            description="Walk-ins and check-ins appear here."
            action={<Button size="sm">Add walk-in</Button>}
            secondaryAction={
              <Button variant="link" size="sm">
                Book appointment
              </Button>
            }
          />
        </Specimen>
        <Specimen label="Search, no results" state="empty" className="w-full max-w-sm rounded-md border border-border">
          <EmptyState
            icon={<SearchX />}
            title="No patient matches “9876”"
            description="Check the number, or register a new patient."
            action={
              <Button variant="secondary" size="sm">
                Register as new patient
              </Button>
            }
          />
        </Specimen>
      </GalleryGroup>

      <GalleryGroup id="alert" title="Alert" note="Inline, no shadow. Info and success are polite (status); warning and danger raised by an action are alerts." className="flex-col items-stretch">
        <div className="grid w-full max-w-2xl gap-2">
          <Alert tone="info" live="off" title="Same mobile as an existing patient">
            Synthetic Patient 01, last visit 3 Aug.
          </Alert>
          <Alert tone="success" live="off" title="Patient registered">
            Synthetic Patient 04 is on today&apos;s queue.
          </Alert>
          <Alert tone="warning" live="off" title="This slot was just booked by someone else">
            Pick another slot or book anyway (overbook).
          </Alert>
          <Alert
            tone="danger"
            live="off"
            title="Couldn't save the visit"
            action={
              <Button variant="secondary" size="sm">
                Retry
              </Button>
            }
            onDismiss={() => {}}
          >
            The connection dropped. Nothing was saved.
          </Alert>
        </div>
      </GalleryGroup>

      <GalleryGroup id="banner" title="Banner" note="Page-level, full width under the top bar; the offline banner sits at the bottom (shell, 06-04b)." className="flex-col items-stretch">
        <div className="grid w-full gap-2">
          <Banner tone="trial" icon={<Clock />}>
            Free trial until 27 Nov. First debit 27 Nov, 10:00 am.
          </Banner>
          <Banner
            tone="past-due"
            icon={<CalendarClock />}
            action={
              <Link href="/dev/ui#banner" className="font-medium underline underline-offset-2">
                Update payment
              </Link>
            }
          >
            Payment failed on 27 Nov.
          </Banner>
          <Banner tone="offline" icon={<WifiOff />}>
            You&apos;re offline · showing data from 10:42 am. Changes are disabled until you reconnect.
          </Banner>
        </div>
      </GalleryGroup>
    </GallerySection>
  );
}
