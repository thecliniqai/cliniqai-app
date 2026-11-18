import React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";

/**
 * Alert (V2-06 06-02c; 06-UI-SPEC Alert, DESIGN_SYSTEM §6.8, §6.11): contextual, inline in a page or sheet. Radius-md,
 * no shadow, padding 10 12; a 16 px icon, a 600 title, the text, and an optional action ("Retry", "Use this patient").
 * Tones `info` / `success` / `warning` / `danger` on their `*-bg` / `*-fg` pair (every pair ≥ 4.5:1,
 * evidence/06-01b/contrast.md). Colour is never the only signal: each tone has its own icon.
 *
 * Live role: `status` (polite) for info and success, `alert` (assertive) for warning and danger, which are what an
 * action raises. A static notice that is on the page from the start passes `live="off"` so nothing is announced.
 *
 * v1 props kept: `type` (`"error"` reads as `danger`; v1 call sites keep `role="alert"`), `title`, `onDismiss`
 * (a "Dismiss alert" button), `className`.
 */
export type AlertTone = "info" | "success" | "warning" | "danger";
/** v1 name of the tone. */
export type AlertType = "info" | "success" | "warning" | "error";

export interface AlertProps {
  tone?: AlertTone;
  type?: AlertType;
  title?: string;
  /** An action button or link after the text. */
  action?: React.ReactNode;
  onDismiss?: () => void;
  /** Override the live role; `"off"` renders none (a notice present from the start). */
  live?: "status" | "alert" | "off";
  className?: string;
  children?: React.ReactNode;
}

const TONE: Record<AlertTone, string> = {
  info: "bg-info-bg text-info-fg",
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
};

const ICON: Record<AlertTone, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export function resolveAlertTone(tone: AlertTone | undefined, type: AlertType | undefined): AlertTone {
  if (tone) return tone;
  if (type === "error") return "danger";
  return type ?? "info";
}

export function Alert({ tone, type, title, action, onDismiss, live, className, children }: AlertProps) {
  const resolved = resolveAlertTone(tone, type);
  const Icon = ICON[resolved];
  const liveRole = live === "off" ? undefined : (live ?? (resolved === "info" || resolved === "success" ? "status" : "alert"));
  return (
    <div
      role={liveRole}
      data-alert={resolved}
      className={cn("flex items-start gap-2.5 rounded-md px-3 py-2.5 text-body-sm", TONE[resolved], className)}
    >
      <Icon aria-hidden="true" className="mt-px size-4 shrink-0" strokeWidth={1.75} />
      <div className="flex min-w-0 grow flex-col gap-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-body-sm">{children}</div>}
        {action && <div className="mt-1.5 flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss alert"
          className={cn(
            "-my-1 -mr-1.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-current hover:bg-surface/60 touch:size-control",
            TRANSITION,
            FOCUS_RING,
          )}
        >
          <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
