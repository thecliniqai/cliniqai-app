import React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "light" | "solid";
export type BadgeColor = "primary" | "success" | "warning" | "error" | "info" | "gray";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  color?: BadgeColor;
  size?: BadgeSize;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

export function Badge({
  variant = "light",
  color = "primary",
  size = "md",
  startIcon,
  endIcon,
  className,
  children,
  ...props
}: BadgeProps) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium rounded-full select-none gap-1 shrink-0";

  const sizeStyles = {
    sm: "px-2 py-0.5 text-[11px] leading-tight",
    md: "px-2.5 py-0.5 text-xs leading-normal",
  }[size];

  const colorStyles = {
    light: {
      primary: "bg-[#EAF2FF] text-[#1769E0] border border-[#1769E0]/20",
      success: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      warning: "bg-amber-50 text-amber-700 border border-amber-200",
      error: "bg-rose-50 text-rose-700 border border-rose-200",
      info: "bg-sky-50 text-sky-700 border border-sky-200",
      gray: "bg-gray-100 text-gray-700 border border-gray-200",
    },
    solid: {
      primary: "bg-[#1769E0] text-white",
      success: "bg-[#18794E] text-white",
      warning: "bg-[#9A5B00] text-white",
      error: "bg-[#B42318] text-white",
      info: "bg-sky-600 text-white",
      gray: "bg-gray-700 text-white",
    },
  }[variant][color];

  return (
    <span
      className={cn(baseStyles, sizeStyles, colorStyles, className)}
      {...props}
    >
      {startIcon && <span className="shrink-0 flex items-center">{startIcon}</span>}
      <span>{children}</span>
      {endIcon && <span className="shrink-0 flex items-center">{endIcon}</span>}
    </span>
  );
}

// Preset helpers for clinical states
export function StatusBadge({ status }: { status: string }) {
  switch (status.toLowerCase()) {
    case "waiting":
      return <Badge color="warning" size="sm">Waiting</Badge>;
    case "in_consultation":
    case "in-consultation":
    case "with_doctor":
      return <Badge color="info" size="sm">In Consultation</Badge>;
    case "completed":
      return <Badge color="success" size="sm">Completed</Badge>;
    case "cancelled":
    case "canceled":
      return <Badge color="error" size="sm">Cancelled</Badge>;
    case "no_show":
    case "no-show":
      return <Badge color="gray" size="sm">No Show</Badge>;
    default:
      return <Badge color="gray" size="sm" className="capitalize">{status.replace(/_/g, " ")}</Badge>;
  }
}
