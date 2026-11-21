"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getConsultationDraft, saveConsultationDraft } from "@/features/consultation/actions";
import type { DraftFields } from "@/features/consultation/draft";
import {
  createDraftSaver,
  type DraftSaver,
  type DraftSaverState,
  type FlushResult,
} from "@/features/consultation/draft-saver";
import { newClientRequestId } from "@/lib/commands/use-command";
import { clockOf } from "@/lib/datetime";
import { useClinicTimeZone } from "@/lib/datetime/client";
import { registerBusy } from "@/lib/pwa/dirty-guard";
import { onAppErrorCode } from "@/lib/pwa/lock";
import type { SaveStatusProps } from "@/components/clinical/save-status";

/**
 * Binds the consult draft saver (features/consultation/draft-saver.ts) to the workspace (V2-09b R-4). The draft lives in memory only: nothing is
 * written to localStorage, sessionStorage, IndexedDB or Cache Storage (PWA §4 D-3). The hook
 *  - creates one saver per record state (`resetKey`): after Amend or Finalize the server copy is the new base;
 *  - saves on blur (focus leaves a field), when the page is hidden (`visibilitychange`, `pagehide`) and when the device comes back online;
 *  - registers `beforeunload` only while something is unsaved or a save is in flight, so an idle or saved consult leaves without a prompt;
 *  - exposes `flush()` for Sign, Amend, Finalize, Finish, "Save draft" and Ctrl/Cmd+S, and the props of `SaveStatus`.
 * A read-only record has no saver (`enabled` false): `flush()` is then a success with nothing to save.
 */

const IDLE: DraftSaverState = {
  saveState: "idle",
  savedAt: null,
  version: 0,
  dirtyFields: [],
  unsaved: false,
  conflict: null,
  locked: false,
  error: null,
};

export interface UseConsultDraft {
  state: DraftSaverState;
  /** Hands the saver what is on screen; call it whenever a draft field changes. */
  update(fields: DraftFields): void;
  flush(): Promise<FlushResult>;
  resolveConflict(choice: "theirs" | "mine"): Promise<FlushResult>;
  saveStatusProps: SaveStatusProps;
}

export function useConsultDraft(options: {
  visitId: string;
  enabled: boolean;
  /** A new saver is made when this changes (the record state). */
  resetKey: string;
  serverFields: DraftFields;
  serverVersion: number;
  /** Fields that arrived from the server (a rebase, "Use the other version"): the screen must show them. */
  onRebased: (fields: Partial<DraftFields>) => void;
}): UseConsultDraft {
  const { visitId, enabled, resetKey } = options;
  const timeZone = useClinicTimeZone();
  const saverRef = useRef<DraftSaver | null>(null);
  const latest = useRef(options);
  const [state, setState] = useState<DraftSaverState>(IDLE);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!enabled) {
      saverRef.current = null;
      return;
    }
    const saver = createDraftSaver({
      visitId,
      initial: { fields: latest.current.serverFields, version: latest.current.serverVersion },
      transport: (request) =>
        saveConsultationDraft({
          visit_id: request.visitId,
          expected_version: request.expectedVersion,
          patch: request.patch as never,
          client_request_id: request.clientRequestId,
        }),
      readServer: () => getConsultationDraft(visitId),
      newId: newClientRequestId,
      isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      registerBusy,
      onAppErrorCode: (code) => void onAppErrorCode(code),
      onRebased: (fields) => latest.current.onRebased(fields),
      onState: setState,
    });
    saverRef.current = saver;
    return () => {
      saver.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [visitId, enabled, resetKey]);

  // Blur, hidden, online.
  useEffect(() => {
    if (!enabled) return;
    const onFocusOut = () => saverRef.current?.blur();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saverRef.current?.hidden();
    };
    const onPageHide = () => saverRef.current?.hidden();
    const onOnline = () => saverRef.current?.online();
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled]);

  // The unload guard exists only while the draft is dirty or a save is in flight (R-4).
  const unsaved = enabled && state.unsaved;
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  const update = useCallback((fields: DraftFields) => saverRef.current?.update(fields), []);
  const flush = useCallback(async (): Promise<FlushResult> => {
    const saver = saverRef.current;
    if (!saver) return { ok: true };
    // What is on screen right now is what Sign, Amend or Finish must see saved.
    return saver.flush();
  }, []);
  const resolveConflict = useCallback(
    (choice: "theirs" | "mine"): Promise<FlushResult> => saverRef.current?.resolveConflict(choice) ?? Promise.resolve({ ok: true } as FlushResult),
    [],
  );

  let savedAt: string | null = null;
  if (state.savedAt) {
    const { hour, minute } = clockOf(new Date(state.savedAt), timeZone);
    savedAt = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const saveStatusProps: SaveStatusProps = {
    state: enabled ? state.saveState : "idle",
    savedAt,
    onRetry: state.saveState === "error" ? () => void flush() : undefined,
  };

  return { state: enabled ? state : IDLE, update, flush, resolveConflict, saveStatusProps };
}
