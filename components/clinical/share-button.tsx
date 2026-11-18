"use client";

import { useSyncExternalStore } from "react";
import { Link2, Share2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";

/**
 * ShareButton (V2-06 06-03a; 06-UI-SPEC ShareButton, CD-25; PWA_STRATEGY §4 D-6): shares a link with the system share
 * sheet (Web Share API) on the user's press. Where the browser has no share sheet it becomes "Copy link" and confirms
 * with the toast "Link copied". Nothing is stored on the device (D-6): no storage, no cache, no history entry. The
 * page decides what the link is (a signed, short-lived document link or a page URL); this component never logs it.
 *
 * Secondary button. Server rendering and the first client render say "Share"; after hydration the label follows the
 * browser's ability (no hydration mismatch: `useSyncExternalStore` with a server snapshot).
 */
export interface ShareButtonProps extends Omit<ButtonProps, "onClick" | "children" | "type"> {
  url: string;
  /** Title passed to the share sheet. */
  title?: string;
  /** Text passed to the share sheet. */
  text?: string;
}

const noSubscription = () => () => {};

function canShare(url: string): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    return typeof navigator.canShare === "function" ? navigator.canShare({ url }) : true;
  } catch {
    return false;
  }
}

export function ShareButton({ url, title, text, variant = "secondary", ...props }: ShareButtonProps) {
  const shareable = useSyncExternalStore(
    noSubscription,
    () => canShare(url),
    () => true,
  );

  async function share() {
    if (canShare(url)) {
      try {
        await navigator.share({ url, title, text });
      } catch (error) {
        // The user closed the sheet: nothing to report. Anything else: say it did not go out.
        if (!(error instanceof DOMException && error.name === "AbortError")) notify.error("Couldn't open the share sheet");
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      notify.success("Link copied");
    } catch {
      notify.error("Couldn't copy the link");
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      startIcon={shareable ? <Share2 aria-hidden="true" className="size-4" /> : <Link2 aria-hidden="true" className="size-4" />}
      onClick={() => void share()}
      data-share-mode={shareable ? "share" : "copy"}
      {...props}
    >
      {shareable ? "Share" : "Copy link"}
    </Button>
  );
}
