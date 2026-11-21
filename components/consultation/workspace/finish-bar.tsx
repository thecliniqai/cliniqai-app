import type { ReactNode } from "react";

/**
 * The fixed Finish bar (phones, below 768 px; 06-UI-SPEC §7): a Patient button (09B-02b) beside the primary action of the record state
 * ("Finish visit", "Finalize amendment", "Amend"); `pb-safe` keeps it above the home indicator. The workspace pads the note so nothing hides behind it.
 */
export function FinishBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-finish-bar=""
      className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-surface px-4 pt-2 pb-safe md:hidden [&>*]:flex-1"
    >
      {children}
    </div>
  );
}
