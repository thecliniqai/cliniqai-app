import { appError, type AppError, type Result } from "@/lib/errors/app-error";
import { COMMAND_RETRY_DELAY_MS, COMMAND_TIMEOUT_MS } from "@/lib/commands/use-command";
import {
  changedDraftKeys,
  draftPatchValue,
  type DraftFieldKey,
  type DraftFields,
  type ServerDraft,
} from "./draft";
import { rebaseDraft } from "./draft-rebase";
import { vitalsSchema } from "./schema";

/**
 * The consult draft saver (V2-09b R-4, R-5; PWA_STRATEGY §3.8, D3). No React and no clock of its own: time, transport and ids are injected, so
 * `tests/consultation/draft-saver.spec.ts` drives it with a fake clock.
 *
 * The draft is held in memory only (no storage API, PWA §4 D-3). It reaches the server
 *  - at most `maxWaitMs` (5 s) after the first unsaved change, a wait that further typing does NOT reset;
 *  - on `blur()` (focus left an edited field), `hidden()` (the app went to the background) and `online()` (after an offline save attempt);
 *  - when a caller awaits `flush()` (Sign, Amend, Finalize, Finish, navigation, "Save draft", Ctrl/Cmd+S).
 *
 * One save is in flight at a time; edits made during it go into the next one. Each attempt carries its own `client_request_id`, bound to its
 * exact patch and expected version, and is never re-sent with another payload: a timeout (`COMMAND_TIMEOUT_MS`) or a transport failure is
 * retried once with the same id after `COMMAND_RETRY_DELAY_MS`; an attempt that still failed is kept and the next save (Retry, a flush, the next
 * timer) re-sends exactly it first. The answer of an attempt that already timed out is ignored. Offline at save time sends nothing and shows
 * "offline"; `online()` saves.
 *
 * Conflicts (R-5): `DRAFT_CONFLICT` makes the saver read the server copy (`readServer`) and rebase field by field (`rebaseDraft`). Without an
 * overlap the merged draft is re-sent at the new version at once; with an overlap the saver stops and exposes `conflict` until
 * `resolveConflict("theirs" | "mine")`. "Keep mine" re-sends with the audit flag `conflict_overwrite`. Nothing is overwritten silently.
 *
 * Held back (09B-06a, review A-7): a dirty field the server would refuse (`isSendable` false: a vital out of range or half typed, a follow-up date outside
 * the range the command takes) is not sent. It stays unsaved (the unload guard stays on, `invalidFields` names it so the screen can mark it) and the other
 * dirty fields are saved as usual; `flush()` answers `invalid` while only held-back fields are left, so Sign and Finalize stop until it is corrected.
 */

export type DraftSaveState = "idle" | "saving" | "saved" | "offline" | "error";

export interface DraftSaveRequest {
  visitId: string;
  expectedVersion: number;
  patch: Partial<Record<DraftFieldKey, unknown>> & { conflict_overwrite?: boolean };
  clientRequestId: string;
}

export interface DraftSaveOk {
  draftVersion: number;
  replayed: boolean;
  started: boolean;
}

export interface DraftConflict {
  fields: DraftFieldKey[];
  mine: DraftFields;
  theirs: DraftFields;
}

export interface DraftSaverState {
  saveState: DraftSaveState;
  /** ISO time of the last successful save. */
  savedAt: string | null;
  version: number;
  dirtyFields: DraftFieldKey[];
  /** A save is in flight, or an unsent or unresolved change exists: the unload guard is on. */
  unsaved: boolean;
  conflict: DraftConflict | null;
  /** The server refuses drafts for this visit (signed, completed or cancelled). */
  locked: boolean;
  error: AppError | null;
  /** Dirty fields held back because the server would refuse them (A-7); they are sent once corrected. */
  invalidFields: DraftFieldKey[];
}

export type FlushResult =
  | { ok: true }
  | { ok: false; reason: "conflict" | "locked" | "offline" | "error" | "invalid"; error?: AppError };

export interface DraftSaverDeps {
  visitId: string;
  initial: { fields: DraftFields; version: number };
  transport(request: DraftSaveRequest): Promise<Result<DraftSaveOk>>;
  readServer(): Promise<Result<ServerDraft>>;
  newId(): string;
  isOnline?: () => boolean;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule(fn: () => void, ms: number): () => void;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Marks a save in flight for the app's safe-point update (lib/pwa/dirty-guard); returns the function that ends it. */
  registerBusy?: () => () => void;
  onAppErrorCode?: (code: string) => void;
  /** Called with the fields that arrived from the server (a rebase or "Use the other version") so the screen can show them. */
  onRebased?: (fields: Partial<DraftFields>) => void;
  onState?: (state: DraftSaverState) => void;
  maxWaitMs?: number;
  /** May this field's on-screen value be sent (09B-06a, A-7)? Default `draftFieldSendable`: vitals that pass `vitalsSchema`. */
  isSendable?: (key: DraftFieldKey, fields: DraftFields) => boolean;
}

/** The default `isSendable` (A-7): the vitals are sent only when `vitalsSchema` accepts them (ranges, integers, systolic above diastolic). */
export function draftFieldSendable(key: DraftFieldKey, fields: DraftFields): boolean {
  if (key !== "vitals" || fields.vitals === null) return true;
  return vitalsSchema.safeParse(fields.vitals).success;
}

export interface DraftSaver {
  /** Replaces the given fields of the in-memory draft with what is on screen; arms the save timer when something differs from the server copy. */
  update(fields: Partial<DraftFields>): void;
  blur(): void;
  hidden(): void;
  online(): void;
  /** Resolves when nothing is unsaved (ok), or says why it could not be saved. Never rejects. */
  flush(): Promise<FlushResult>;
  resolveConflict(choice: "theirs" | "mine"): Promise<FlushResult>;
  getState(): DraftSaverState;
  /** The in-memory draft (what is on screen). */
  getDraft(): DraftFields;
  /**
   * The screen goes away (an in-app navigation, Back, a record-state change; 09B-06a, review A-1): what is unsent is saved now (a flush, without waiting
   * for the 5 s timer), and the saver stops reporting state at once and is disposed when that save settles. Resolves with the flush's result.
   */
  release(): Promise<FlushResult>;
  dispose(): void;
}

export const DRAFT_MAX_WAIT_MS = 5_000;

const MAX_REBASES_PER_SAVE = 3;

interface Attempt {
  id: string;
  expectedVersion: number;
  patch: DraftSaveRequest["patch"];
  keys: DraftFieldKey[];
  /** The values this attempt sends, which become the server copy when it succeeds. */
  sent: Partial<DraftFields>;
}

const isConflict = (error: AppError) => error.code === "CONFLICT" && error.reason === "DRAFT_CONFLICT";
const isLockedRefusal = (error: AppError) => error.code === "CONFLICT" && error.reason === "DRAFT_LOCKED";
/** A failure that does not say whether the command committed. */
const isUnknownOutcome = (error: AppError) => error.code === "DEPENDENCY_FAILED" || error.code === "INTERNAL";

function serverCopyLocked(server: ServerDraft): boolean {
  if (server.status === "completed" || server.status === "cancelled") return true;
  return !!server.signedAt && server.status !== "in_consultation";
}

export function createDraftSaver(deps: DraftSaverDeps): DraftSaver {
  const isOnline = deps.isOnline ?? (() => true);
  const maxWait = deps.maxWaitMs ?? DRAFT_MAX_WAIT_MS;
  const registerBusy = deps.registerBusy ?? (() => () => undefined);
  const isSendable = deps.isSendable ?? draftFieldSendable;

  let base: DraftFields = { ...deps.initial.fields };
  let current: DraftFields = { ...deps.initial.fields };
  let version = deps.initial.version;
  let saveState: DraftSaveState = "idle";
  let savedAt: string | null = null;
  let error: AppError | null = null;
  let conflict: DraftConflict | null = null;
  let locked = false;
  let pending: Attempt | null = null;
  let overwriteNext = false;
  let dirtySince: number | null = null;
  let cancelTimer: (() => void) | null = null;
  let inFlight: Promise<FlushResult> | null = null;
  let disposed = false;
  /** Released (A-1): no more state to the screen; the last save still runs. */
  let released = false;

  const dirtyKeys = () => changedDraftKeys(base, current);
  /** The dirty fields that may be sent now; the rest are held back until corrected (A-7). */
  const sendableKeys = () => dirtyKeys().filter((key) => isSendable(key, current));
  const heldKeys = () => dirtyKeys().filter((key) => !isSendable(key, current));

  function snapshot(): DraftSaverState {
    const dirtyFields = dirtyKeys();
    return {
      saveState,
      savedAt,
      version,
      dirtyFields,
      unsaved: inFlight !== null || pending !== null || dirtyFields.length > 0,
      conflict,
      locked,
      error,
      invalidFields: heldKeys(),
    };
  }

  function emit() {
    if (!disposed && !released) deps.onState?.(snapshot());
  }

  function disarm() {
    cancelTimer?.();
    cancelTimer = null;
  }

  /** Arms the maximum-wait timer from the first unsaved change; a running timer is never pushed back. */
  function arm() {
    if (disposed || conflict || locked || inFlight || cancelTimer) return;
    if (sendableKeys().length === 0 && !pending) {
      dirtySince = null;
      return;
    }
    dirtySince ??= deps.now();
    const wait = Math.max(0, dirtySince + maxWait - deps.now());
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      void startSave();
    }, wait);
  }

  /** One request, with the single automatic retry (same id). Settles once; whatever a timed-out attempt answers later is ignored. */
  function once(attempt: Attempt): Promise<Result<DraftSaveOk>> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (r: Result<DraftSaveOk>) => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(r);
      };
      const cancel = deps.schedule(
        () => finish({ ok: false, error: appError("DEPENDENCY_FAILED", { reason: "TIMEOUT" }) }),
        COMMAND_TIMEOUT_MS,
      );
      try {
        deps
          .transport({ visitId: deps.visitId, expectedVersion: attempt.expectedVersion, patch: attempt.patch, clientRequestId: attempt.id })
          .then(finish, () => finish({ ok: false, error: appError("DEPENDENCY_FAILED") }));
      } catch {
        finish({ ok: false, error: appError("DEPENDENCY_FAILED") });
      }
    });
  }

  async function send(attempt: Attempt): Promise<Result<DraftSaveOk>> {
    const done = registerBusy();
    try {
      let result = await once(attempt);
      if (!result.ok && result.error.code === "DEPENDENCY_FAILED") {
        await deps.sleep(COMMAND_RETRY_DELAY_MS);
        result = await once(attempt);
      }
      if (!result.ok) deps.onAppErrorCode?.(result.error.code);
      return result;
    } finally {
      done();
    }
  }

  function buildAttempt(): Attempt | null {
    const keys = sendableKeys();
    if (keys.length === 0) return null;
    const patch: DraftSaveRequest["patch"] = {};
    const sent: Partial<DraftFields> = {};
    for (const key of keys) {
      patch[key] = draftPatchValue(key, current);
      (sent as Record<string, unknown>)[key] = structuredCloneJson(current[key]);
    }
    if (overwriteNext) patch.conflict_overwrite = true;
    return { id: deps.newId(), expectedVersion: version, patch, keys, sent };
  }

  async function doSave(rebases = 0): Promise<FlushResult> {
    if (conflict) return { ok: false, reason: "conflict" };
    if (locked) return { ok: false, reason: "locked", error: error ?? undefined };
    if (!isOnline()) {
      saveState = "offline";
      emit();
      return { ok: false, reason: "offline" };
    }
    const attempt = pending ?? buildAttempt();
    if (!attempt) return { ok: true };
    // What changes from here on belongs to the next save, and its maximum wait starts at its own first change.
    dirtySince = null;
    saveState = "saving";
    error = null;
    emit();

    const result = await send(attempt);
    if (disposed) return { ok: true };

    if (result.ok) {
      pending = null;
      overwriteNext = false;
      version = result.value.draftVersion;
      base = { ...base, ...attempt.sent } as DraftFields;
      savedAt = new Date(deps.now()).toISOString();
      saveState = "saved";
      error = null;
      if (sendableKeys().length > 0) dirtySince ??= deps.now();
      emit();
      arm();
      return { ok: true };
    }

    const failure = result.error;
    if (isConflict(failure)) {
      pending = null;
      return handleConflict(failure, rebases);
    }
    if (isLockedRefusal(failure)) {
      pending = null;
      locked = true;
      saveState = "error";
      error = failure;
      emit();
      return { ok: false, reason: "locked", error: failure };
    }
    // An unknown outcome keeps the attempt: the next save re-sends exactly it (the server replays by id). A definite refusal drops it.
    pending = isUnknownOutcome(failure) ? attempt : null;
    saveState = "error";
    error = failure;
    emit();
    return { ok: false, reason: "error", error: failure };
  }

  async function handleConflict(failure: AppError, rebases: number): Promise<FlushResult> {
    const server = await deps.readServer();
    if (disposed) return { ok: true };
    if (!server.ok) {
      saveState = "error";
      error = server.error;
      emit();
      return { ok: false, reason: "error", error: server.error };
    }
    const theirs = server.value;
    if (serverCopyLocked(theirs)) {
      locked = true;
      saveState = "error";
      error = failure;
      emit();
      return { ok: false, reason: "locked", error: failure };
    }
    const rebased = rebaseDraft(base, current, theirs.fields);
    current = rebased.merged;
    base = { ...theirs.fields };
    version = theirs.draftVersion;
    if (rebased.fromTheirs.length > 0) {
      const arrived: Partial<DraftFields> = {};
      for (const key of rebased.fromTheirs) (arrived as Record<string, unknown>)[key] = theirs.fields[key];
      deps.onRebased?.(arrived);
    }
    if (rebased.overlapping.length > 0) {
      conflict = { fields: rebased.overlapping, mine: { ...current }, theirs: { ...theirs.fields } };
      saveState = "error";
      error = failure;
      emit();
      return { ok: false, reason: "conflict", error: failure };
    }
    if (rebases >= MAX_REBASES_PER_SAVE) {
      saveState = "error";
      error = failure;
      emit();
      return { ok: false, reason: "error", error: failure };
    }
    return doSave(rebases + 1);
  }

  function startSave(): Promise<FlushResult> {
    disarm();
    if (inFlight) return inFlight;
    const run = doSave().finally(() => {
      inFlight = null;
      emit();
      // Edits made during a save that succeeded wait for their own maximum wait, which started at their first change. After a failure or while
      // offline nothing re-arms by itself (no retry loop): the next edit, a blur, `online()` or the doctor's Retry sends again.
      if (saveState === "saved") arm();
    });
    inFlight = run;
    return run;
  }

  async function flush(): Promise<FlushResult> {
    for (let i = 0; i < 8; i++) {
      if (inFlight) await inFlight;
      if (conflict) return { ok: false, reason: "conflict" };
      if (locked) return { ok: false, reason: "locked", error: error ?? undefined };
      if (!pending && sendableKeys().length === 0) return heldKeys().length > 0 ? { ok: false, reason: "invalid" } : { ok: true };
      const result = await startSave();
      if (!result.ok) return result;
    }
    return { ok: false, reason: "error", error: error ?? undefined };
  }

  function resolveConflict(choice: "theirs" | "mine"): Promise<FlushResult> {
    const open = conflict;
    if (!open) return flush();
    conflict = null;
    if (choice === "theirs") {
      const arrived: Partial<DraftFields> = {};
      for (const key of open.fields) {
        (current as unknown as Record<string, unknown>)[key] = open.theirs[key];
        (arrived as Record<string, unknown>)[key] = open.theirs[key];
      }
      deps.onRebased?.(arrived);
    } else {
      overwriteNext = true;
    }
    emit();
    return flush();
  }

  return {
    update(fields) {
      if (disposed) return;
      current = { ...current, ...fields };
      const dirty = dirtyKeys().length > 0;
      const sendable = sendableKeys().length > 0;
      if (sendable) dirtySince ??= deps.now();
      if (dirty && saveState === "saved") saveState = "idle";
      if (!sendable && !pending) {
        disarm();
        dirtySince = null;
      } else {
        arm();
      }
      emit();
    },
    blur() {
      if (disposed || conflict || locked) return;
      if (sendableKeys().length > 0 || pending) void startSave();
    },
    hidden() {
      if (disposed || conflict || locked) return;
      if (sendableKeys().length > 0 || pending) void startSave();
    },
    online() {
      if (disposed || conflict || locked) return;
      if (saveState === "offline" || pending || sendableKeys().length > 0) void startSave();
    },
    flush,
    resolveConflict,
    getState: snapshot,
    getDraft: () => ({ ...current }),
    release() {
      if (disposed || released) return Promise.resolve({ ok: true } as FlushResult);
      released = true;
      disarm();
      const last: Promise<FlushResult> = conflict || locked ? Promise.resolve({ ok: false, reason: conflict ? "conflict" : "locked" }) : flush();
      return last.finally(() => {
        disposed = true;
        disarm();
      });
    },
    dispose() {
      disposed = true;
      disarm();
    },
  };
}

/** The draft holds JSON only, so a JSON round trip is a faithful deep copy (and keeps the sent values immune to later edits). */
function structuredCloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
