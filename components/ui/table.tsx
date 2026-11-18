import React from "react";
import { cn } from "@/lib/utils";

/**
 * v1 table parts as a thin adapter (V2-06 06-02c; 06-PLAN 06-02c Files: "v1 `table` becomes an adapter"): the same
 * exports and props, drawn with the DataTable look (`data-table.tsx`, 06-UI-SPEC DataTable) on semantic tokens:
 * hairline container (radius-md, no shadow), header surface-soft with the 11/600 uppercase caption in fg-muted,
 * body-sm cells (padding 8 12), hairline rows, tabular numerals, row hover `hover`. New screens use `DataTable` /
 * `DataView`; v1 screens keep these until their owner phase rebuilds them.
 */
export function TableContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-x-auto rounded-md border border-border bg-surface", className)} {...props} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-left text-body-sm text-fg tabular-nums", className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-border bg-surface-soft text-caption font-semibold tracking-[0.04em] text-fg-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border bg-surface", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors duration-(--duration-fast) last:border-b-0 hover:bg-hover",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-3 py-2 font-semibold", className)} {...props} />;
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}
