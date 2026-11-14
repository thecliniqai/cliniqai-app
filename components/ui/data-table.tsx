"use client";

import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { Alert } from "./alert";
import { Button } from "./button";
import { Skeleton } from "./skeleton";

/**
 * DataTable (V2-06 06-02c; 06-UI-SPEC DataTable, DESIGN_SYSTEM §6.6) for ≥ lg, and the column model it shares with
 * DataList (< lg). `DataView` (`data-view.tsx`) renders the table from 1024 px and the list below it (a CSS switch;
 * the hidden one is `display: none`, so assistive technology meets one of them).
 *
 * Table look: header surface-soft, caption 11/600 uppercase (tracking 0.04em), fg-muted, padding 8 12, bottom
 * hairline, sticky; cells body-sm, padding 8 12 (≈ 36 px rows), hairline rows, tabular numerals; numeric columns
 * right-aligned; row hover `hover`. The primary cell is a link (the column's `cell` renders the `<a>`), never a
 * clickable `<tr>`. Row actions (one inline + ⋯) are always visible, never hover-only.
 *
 * Sorting: a sortable header is a button inside the `<th>`; the `<th>` carries `aria-sort` (ascending / descending on
 * the sorted column, none on the other sortable ones). Pressing it sorts ascending, then toggles. The caller sorts the
 * rows (server or client) and passes `sort` back.
 *
 * States: `loading` (5 skeleton rows and a "Loading" status), empty (`empty` in the body), `error` (an inline danger
 * Alert with Retry), stale (a warning Alert above, "Showing data from 10:42 am · Retry"), ready.
 */
export type SortDirection = "ascending" | "descending";

export interface DataSort {
  column: string;
  direction: SortDirection;
}

export interface DataColumn<Row> {
  id: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /** Right-aligned with tabular numerals. */
  numeric?: boolean;
  sortable?: boolean;
  /**
   * Where the DataList shows this column: `title` (line 1, the primary link), `status` (line 1, after the title),
   * `meta` (line 2, joined with " · "; the default) or `hidden`.
   */
  list?: "title" | "status" | "meta" | "hidden";
  /** Width or alignment classes for the table cells. */
  className?: string;
}

export interface DataViewState {
  /** `loading` draws skeleton rows; `error` the inline Alert; `ready` the rows (or `empty`). */
  state?: "ready" | "loading" | "error";
  error?: { message: string; onRetry?: () => void };
  /** Data shown is older than it should be: "Showing data from {since}". */
  stale?: { since: string; onRetry?: () => void } | null;
  /** Shown in place of the rows when there are none (an EmptyState). */
  empty?: React.ReactNode;
}

export interface DataTableProps<Row> extends DataViewState {
  /** The table's accessible name ("Patients"). */
  label: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** One inline action plus a ⋯ menu, per row. */
  actions?: (row: Row) => React.ReactNode;
  sort?: DataSort | null;
  onSortChange?: (sort: DataSort) => void;
  className?: string;
}

export const SKELETON_ROWS = 5;

export function nextSort(current: DataSort | null | undefined, column: string): DataSort {
  if (current?.column === column) {
    return { column, direction: current.direction === "ascending" ? "descending" : "ascending" };
  }
  return { column, direction: "ascending" };
}

export function StaleNotice({ since, onRetry }: { since: string; onRetry?: () => void }) {
  return (
    <Alert
      tone="warning"
      live="status"
      action={
        onRetry ? (
          <Button variant="link" size="sm" onClick={onRetry} className="min-h-0 px-0 text-current touch:min-h-control">
            Retry
          </Button>
        ) : undefined
      }
    >
      Showing data from {since}
    </Alert>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      tone="danger"
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

const TH = "h-8 px-3 py-2 text-left text-caption font-semibold tracking-[0.04em] text-fg-muted uppercase";
const TD = "px-3 py-2 align-middle";

export function DataTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  actions,
  sort,
  onSortChange,
  state = "ready",
  error,
  stale,
  empty,
  className,
}: DataTableProps<Row>) {
  const span = columns.length + (actions ? 1 : 0);
  const loading = state === "loading";
  return (
    <div className={cn("flex flex-col gap-2", className)} data-data-table="">
      {stale && state === "ready" && <StaleNotice since={stale.since} onRetry={stale.onRetry} />}
      {loading && (
        <p role="status" className="sr-only">
          Loading {label.toLowerCase()}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table aria-label={label} aria-busy={loading || undefined} className="w-full border-collapse text-body-sm text-fg">
          <thead>
            <tr>
              {columns.map((column) => {
                const sorted = sort?.column === column.id ? sort.direction : null;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={column.sortable ? (sorted ?? "none") : undefined}
                    className={cn(
                      TH,
                      "sticky top-0 z-10 border-b border-border bg-surface-soft",
                      column.numeric && "text-right",
                      column.sortable && "py-0",
                      column.className,
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(sort, column.id))}
                        className={cn(
                          "-mx-1.5 inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-sm px-1.5 uppercase hover:text-fg",
                          sorted && "text-fg",
                          column.numeric && "flex-row-reverse",
                          TRANSITION,
                          FOCUS_RING,
                        )}
                      >
                        <span>{column.header}</span>
                        {sorted === "ascending" ? (
                          <ArrowUp aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                        ) : sorted === "descending" ? (
                          <ArrowDown aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                        ) : (
                          <ArrowUpDown aria-hidden="true" className="size-3.5 text-fg-icon" strokeWidth={1.75} />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {actions && (
                <th scope="col" className={cn(TH, "sticky top-0 z-10 border-b border-border bg-surface-soft text-right")}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <tr key={`skeleton-${i}`} aria-hidden="true" className="border-b border-border last:border-b-0">
                  {Array.from({ length: span }, (_, j) => (
                    <td key={j} className={TD}>
                      <Skeleton shape="text" className={cn("my-1", j === 0 ? "w-32" : "w-16", columns[j]?.numeric && "ml-auto")} />
                    </td>
                  ))}
                </tr>
              ))}
            {state === "error" && (
              <tr>
                <td colSpan={span} className="p-3">
                  <ErrorNotice message={error?.message ?? "Couldn't load this list."} onRetry={error?.onRetry} />
                </td>
              </tr>
            )}
            {state === "ready" && rows.length === 0 && (
              <tr>
                <td colSpan={span} className="p-0">
                  {empty}
                </td>
              </tr>
            )}
            {state === "ready" &&
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="border-b border-border transition-colors duration-(--duration-fast) last:border-b-0 hover:bg-hover"
                >
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(TD, "tabular-nums", column.numeric && "text-right", column.className)}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {actions && (
                    <td className={cn(TD, "text-right")}>
                      <div className="flex items-center justify-end gap-1">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
