import React from "react";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from "lucide-react";

export type AlertType = "info" | "success" | "warning" | "error";

export interface AlertProps {
  type?: AlertType;
  title?: string;
  className?: string;
  onDismiss?: () => void;
  children: React.ReactNode;
}

export function Alert({
  type = "info",
  title,
  className,
  onDismiss,
  children,
}: AlertProps) {
  const icons = {
    info: <Info className="w-5 h-5 text-[#1769E0] shrink-0" />,
    success: <CheckCircle2 className="w-5 h-5 text-[#18794E] shrink-0" />,
    warning: <AlertTriangle className="w-5 h-5 text-[#9A5B00] shrink-0" />,
    error: <AlertCircle className="w-5 h-5 text-[#B42318] shrink-0" />,
  };

  const typeStyles = {
    info: "bg-[#EAF2FF] border-[#BFD8FF] text-[#1769E0]",
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    error: "bg-rose-50 border-rose-200 text-rose-800",
  }[type];

  return (
    <div
      role="alert"
      className={cn(
        "p-4 rounded-xl border flex items-start gap-3 shadow-theme-xs",
        typeStyles,
        className
      )}
    >
      {icons[type]}
      <div className="grow space-y-0.5 text-sm">
        {title && <h4 className="font-semibold">{title}</h4>}
        <div className="text-xs sm:text-sm opacity-90 leading-relaxed">{children}</div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-black/5 transition-opacity cursor-pointer"
          aria-label="Dismiss alert"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
