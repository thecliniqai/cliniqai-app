"use client";

import { useRef, useSyncExternalStore } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Take photo" (V2-09c 09C-05, R-15, PWA-12): a button beside the upload control, shown where the primary pointer is a finger (phones and tablets), that opens
 * the device camera through a file input with `capture="environment"` and hands the picture to the same upload queue. It is a separate control, not part of
 * FileDrop. Nothing is kept: the file goes to `onTake` and the input is cleared, so the same shot can be taken again.
 */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

export interface TakePhotoButtonProps {
  onTake: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}

export function TakePhotoButton({ onTake, disabled = false, label = "Take photo" }: TakePhotoButtonProps) {
  const coarse = useCoarsePointer();
  const inputRef = useRef<HTMLInputElement>(null);
  if (!coarse) return null;
  return (
    <div data-take-photo="">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        data-take-photo-input=""
        disabled={disabled}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length > 0) onTake(files);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="secondary" startIcon={<Camera />} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
    </div>
  );
}
