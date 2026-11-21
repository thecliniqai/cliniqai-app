import { FilePenLine } from "lucide-react";
import { Banner } from "@/components/ui/banner";

/**
 * The amending banner (V2-09a R-16, V2-09b R-6): the `past-due` (warning) tone, a polite status, the signed version and the next one, the reason
 * the amendment was started with and, when known, the clinic date it was opened ("opened 21 Nov 2026"). No new design token (Q-13).
 * The wrapper is the focus target after Amend (review B-3), so it takes a ref and `tabIndex={-1}`.
 */
export function AmendingBanner({
  signedVersion,
  reason,
  openedLabel,
  bannerRef,
}: {
  signedVersion: number;
  reason?: string | null;
  /** The clinic-zone date the amendment was opened, already formatted. */
  openedLabel?: string | null;
  bannerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={bannerRef} tabIndex={-1} data-testid="amending-banner" className="outline-none focus-visible:focus-ring">
      <Banner tone="past-due" role="status" icon={<FilePenLine />}>
        Amending a signed consultation (v{signedVersion} to v{signedVersion + 1})
        {reason ? `: ${reason}` : ""}
        {openedLabel ? ` · opened ${openedLabel}` : ""}
      </Banner>
    </div>
  );
}
