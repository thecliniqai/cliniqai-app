"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { ErrorNotice, SKELETON_ROWS, StaleNotice, type DataColumn, type DataViewState } from "./data-table";
import { Skeleton } from "./skeleton";

/**
 * DataList (V2-06 06-02c; 06-UI-SPEC DataList, DESIGN_SYSTEM §6.6): the < lg form of a DataTable, from the same column
 * model. Each row is a two-line list item: line 1 the `title` column (the primary link, body-md 500) and the `status`
 * column (a StatusChip from 06-03a); line 2 the `meta` columns joined with " · " (12 px fg-muted, tabular). The row's
 * primary action and ⋯ menu sit at the right and are always visible. More rows come from a "Load more" secondary
 * button (no infinite scroll: predictable on slow networks); once the new rows arrive, focus moves to the first of
 * them, so a keyboard user continues where the list grew. Same states as the table.
 */
export interface DataListProps<Row> extends DataViewState {
  /** The list's accessible name ("Patients"). */
  label: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  actions?: (row: Row) => React.ReactNode;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  className?: string;
}

export function DataList<Row>({
  label,
  columns,
  rows,
  rowKey,
  actions,
  state = "ready",
  error,
  stale,
  empty,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  className,
}: DataListProps<Row>) {
  const title = columns.find((c) => c.list === "title") ?? columns[0];
  const status = columns.filter((c) => c.list === "status");
  const meta = columns.filter((c) => c !== title && (c.list ?? "meta") === "meta");
  const loading = state === "loading";
  const list = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);

  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || rows.length <= from) return;
    focusFrom.current = null;
    const first = list.current?.children[from]?.querySelector<HTMLElement>("a[href], button:not([disabled])");
    first?.focus();
  }, [rows.length]);

  return (
    <div className={cn("flex flex-col gap-2", className)} data-data-list="">
      {stale && state === "ready" && <StaleNotice since={stale.since} onRetry={stale.onRetry} />}
      {loading && (
        <p role="status" className="sr-only">
          Loading {label.toLowerCase()}
        </p>
      )}
      {state === "error" && <ErrorNotice message={error?.message ?? "Couldn't load this list."} onRetry={error?.onRetry} />}
      {state === "ready" && rows.length === 0 && <div className="rounded-md border border-border bg-surface">{empty}</div>}
      {(loading || (state === "ready" && rows.length > 0)) && (
        <ul
          ref={list}
          aria-label={label}
          aria-busy={loading || undefined}
          className="divide-y divide-border rounded-md border border-border bg-surface text-body-sm"
        >
          {loading &&
            Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <li key={`skeleton-${i}`} aria-hidden="true" className="flex flex-col gap-2 px-3.5 py-3">
                <Skeleton shape="text" className="h-3.5 w-40" />
                <Skeleton shape="text" className="w-56 max-w-full" />
              </li>
            ))}
          {!loading &&
            rows.map((row) => (
              <li key={rowKey(row)} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="flex min-w-0 grow flex-col gap-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 text-body-md font-medium text-fg">{title.cell(row)}</span>
                    {status.map((column) => (
                      <span key={column.id} className="flex">
                        {column.cell(row)}
                      </span>
                    ))}
                  </div>
                  {meta.length > 0 && (
                    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-label tabular-nums text-fg-muted">
                      {meta.map((column, i) => (
                        <React.Fragment key={column.id}>
                          {i > 0 && <span aria-hidden="true">·</span>}
                          <span>
                            <span className="sr-only">{column.header}: </span>
                            {column.cell(row)}
                          </span>
                        </React.Fragment>
                      ))}
                    </p>
                  )}
                </div>
                {actions && <div className="flex shrink-0 items-center gap-1">{actions(row)}</div>}
              </li>
            ))}
        </ul>
      )}
      {state === "ready" && hasMore && onLoadMore && (
        <Button
          variant="secondary"
          onClick={() => {
            focusFrom.current = rows.length;
            onLoadMore();
          }}
          loading={loadingMore}
          className="self-center"
        >
          Load more
        </Button>
      )}
    </div>
  );
}
