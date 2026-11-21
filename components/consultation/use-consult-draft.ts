"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getConsultationDraft, saveConsultationDraft } from "@/features/consultation/actions";
import type { DraftFields } from "@/features/consultation/draft";
import {
  createDraftSaver,
  draftFieldSendable,
  type DraftSaver,
  type DraftSaverState,
  type FlushResult,
} from "@/features/consultation/draft-saver";
import { newClientRequestId } from "@/lib/commands/use-command";
import { addDaysYmd, clockOf, todayInTz } from "@/lib/datetime";
import { useClinicTimeZone } from "@/lib/datetime/client";
import { registerBusy } from "@/lib/pwa/dirty-guard";
import { onAppErrorCode } from "@/lib/pwa/lock";
import type { SaveStatusProps } from "@/components/clinical/save-status";

/**
 * Binds the consult draft saver (features/consultation/draft-saver.ts) to the workspace (V2-09b R-4). The draft lives in memory only: nothing is
 * written to localStorage, sessionStorage, IndexedDB or Cache Storage (PWA §4 D-3). The hook
 *  - creates one saver per record state (`resetKey`): after Amend or Finalize the server copy is the new base (09B-06a, A-6: the caller passes the
 *    server's current fields, read from the page's latest props, not the mount-time snapshot);
 *  - when the workspace goes away (an in-app navigation, Back) or the record state changes, the old saver is released: what is unsent is saved at once,
 *    then it is disposed (09B-06a, A-1; before, the cleanup only disposed it and up to 5 s of taps were lost);
 *  - saves on blur (focus leaves a field), when the page is hidden (`visibilitychange`, `pagehide`) and when the device comes back online;
 *  - registers `beforeunload` only while something is unsaved or a save is in flight, so an idle or saved consult leaves without a prompt. The guard
 *    follows the saver's own state, in the same call that makes the draft dirty (CI 44924479177: it used to be added by an effect one React render after
 *    the state update, so a tab closed within that render left without the question);
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
  invalidFields: [],
};

/** Adds or removes the `beforeunload` guard held in `slot`; idempotent. */
function syncUnloadGuard(slot: { current: (() => void) | null }, on: boolean): void {
  if (on && !slot.current) {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    slot.current = () => window.removeEventListener("beforeunload", onBeforeUnload);
  } else if (!on && slot.current) {
    slot.current();
    slot.current = null;
  }
}

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
  /** Removes the unload guard while it is registered. */
  const unloadGuard = useRef<(() => void) | null>(null);
  const latest = useRef(options);
  const zone = useRef(timeZone);
  const [state, setState] = useState<DraftSaverState>(IDLE);

  useEffect(() => {
    latest.current = options;
    zone.current = timeZone;
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
      onState: (next) => {
        // The unload guard exists only while the draft is dirty or a save is in flight (R-4), set here and not by an effect a render later.
        syncUnloadGuard(unloadGuard, next.unsaved);
        setState(next);
      },
      // 09B-06a (A-7, S-4): a vital out of range and a follow-up date the command would refuse (before the clinic's today or after today + 366, unless
      // it is the date already stored) are held back, so the other fields still save.
      isSendable: (key, fields) => {
        if (!draftFieldSendable(key, fields)) return false;
        if (key !== "follow_up" || !fields.follow_up) return true;
        const date = fields.follow_up.follow_up_date;
        const today = todayInTz(zone.current);
        return (date >= today && date <= addDaysYmd(today, 366)) || date === latest.current.serverFields.follow_up?.follow_up_date;
      },
    });
    saverRef.current = saver;
    return () => {
      // A-1: flush, then dispose. The save is a server action, so it completes on the server even when this screen is gone.
      void saver.release();
      if (saverRef.current === saver) saverRef.current = null;
      // The released saver reports no more state; the screen it guarded is gone or replaced.
      syncUnloadGuard(unloadGuard, false);
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
