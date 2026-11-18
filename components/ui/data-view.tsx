"use client";

import React from "react";
import { DataList } from "./data-list";
import { DataTable, type DataTableProps } from "./data-table";

/**
 * DataView (V2-06 06-02c; DESIGN_SYSTEM §6.6): one column model, two forms. The DataTable from 1024 px (`lg`), the
 * DataList below. The switch is CSS only (`display: none` on the other form), so nothing remounts on a resize and
 * assistive technology meets exactly one of them.
 */
export interface DataViewProps<Row> extends DataTableProps<Row> {
  /** DataList only: "Load more" (no infinite scroll). */
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}

export function DataView<Row>({ onLoadMore, hasMore, loadingMore, className, ...props }: DataViewProps<Row>) {
  return (
    <div className={className} data-data-view="">
      <DataTable {...props} className="hidden lg:flex" />
      <DataList {...props} onLoadMore={onLoadMore} hasMore={hasMore} loadingMore={loadingMore} className="lg:hidden" />
    </div>
  );
}
