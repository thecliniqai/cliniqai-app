/**
 * V2-09b 09B-01 (R-4, R-5): the consult draft saver with a fake clock and a fake server. No React, no network: time, ids, transport and the server
 * copy are injected (features/consultation/draft-saver.ts). PWA-06b: the 15 s timeout and the one retry with the same id.
 */
import { describe, expect, it, vi } from "vitest";
import { appError, type Result } from "@/lib/errors/app-error";
import { COMMAND_RETRY_DELAY_MS, COMMAND_TIMEOUT_MS } from "@/lib/commands/use-command";
import type { DraftFields, ServerDraft } from "@/features/consultation/draft";
import {
  createDraftSaver,
  DRAFT_MAX_WAIT_MS,
  type DraftSaveOk,
  type DraftSaveRequest,
  type DraftSaverState,
} from "@/features/consultation/draft-saver";

const BASE: DraftFields = {
  vitals: null,
  chief_complaints: [],
  clinical_notes: "",
  specialty_data: null,
  investigations_advised: [],
  advice: [],
  specialty: "general_physician",
  follow_up: null,
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const conflictError = () => appError("CONFLICT", { reason: "DRAFT_CONFLICT" });

function harness(options: { online?: boolean; version?: number } = {}) {
  let now = 1_000_000;
  let nextId = 0;
  let online = options.online ?? true;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  /** The fake server: its copy of the draft and its version. A request commits only when its expected version equals the server's. */
  const server = { version: options.version ?? 0, fields: { ...BASE } as DraftFields, status: "in_consultation", signedAt: null as string | null };
  const committed = new Map<string, Result<DraftSaveOk>>();
  const requests: DraftSaveRequest[] = [];
  /** A responder overrides the server for the next request(s): return undefined to fall through to the fake server. */
  let responder: ((request: DraftSaveRequest, attempt: number) => Promise<Result<DraftSaveOk>> | undefined) | null = null;
  const rebased: Array<Partial<DraftFields>> = [];
  const states: DraftSaverState[] = [];
  let readServerResult: Result<ServerDraft> | null = null;

  const transport = vi.fn(async (request: DraftSaveRequest): Promise<Result<DraftSaveOk>> => {
    requests.push(request);
    const override = responder?.(request, requests.length);
    if (override) return override;
    const replay = committed.get(request.clientRequestId);
    if (replay) return replay.ok ? { ok: true, value: { ...replay.value, replayed: true } } : replay;
    if (server.status !== "in_consultation" || server.signedAt) return { ok: false, error: appError("CONFLICT", { reason: "DRAFT_LOCKED" }) };
    if (request.expectedVersion !== server.version) return { ok: false, error: conflictError() };
    for (const [key, value] of Object.entries(request.patch)) {
      if (key !== "conflict_overwrite") (server.fields as unknown as Record<string, unknown>)[key] = value;
    }
    server.version += 1;
    const ok: Result<DraftSaveOk> = { ok: true, value: { draftVersion: server.version, replayed: false, started: false } };
    committed.set(request.clientRequestId, ok);
    return ok;
  });

  const saver = createDraftSaver({
    visitId: "visit-1",
    initial: { fields: { ...BASE }, version: server.version },
    transport,
    readServer: async () =>
      readServerResult ?? { ok: true, value: { fields: structuredClone(server.fields), draftVersion: server.version, status: server.status, signedAt: server.signedAt } },
    newId: () => `req-${++nextId}`,
    isOnline: () => online,
    schedule: (fn, ms) => {
      const timer = { at: now + ms, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    sleep: (ms) => new Promise<void>((resolve) => timers.push({ at: now + ms, fn: resolve, cancelled: false })),
    now: () => now,
    onRebased: (fields) => rebased.push(fields),
    onState: (state) => states.push(state),
  });

  /** Moves the fake clock forward, running every timer due on the way in order, and lets promises settle after each. */
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      await flush();
      const due = timers.filter((t) => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = Math.max(now, due.at);
      due.cancelled = true;
      due.fn();
    }
    now = end;
    await flush();
  }

  return {
    saver,
    transport,
    requests,
    server,
    rebased,
    states,
    advance,
    setOnline: (value: boolean) => (online = value),
    respond: (fn: typeof responder) => (responder = fn),
    failReadServer: () => (readServerResult = { ok: false, error: appError("INTERNAL") }),
    /** Another writer commits `fields` on the server (version + 1) without this saver knowing. */
    otherWriter(fields: Partial<DraftFields>) {
      Object.assign(server.fields, fields);
      server.version += 1;
    },
  };
}

describe("draft saver: when the draft is saved (R-4)", () => {
  it("sends nothing while nothing differs from the server copy", async () => {
    const h = harness();
    h.saver.update({ clinical_notes: "" });
    await h.advance(60_000);
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.saver.getState()).toMatchObject({ saveState: "idle", unsaved: false, dirtyFields: [] });
  });

  it("saves the changed field only, at the version it read, exactly 5 s after the first unsaved change", async () => {
    const h = harness();
    h.saver.update({ clinical_notes: "first line" });
    await h.advance(DRAFT_MAX_WAIT_MS - 1);
    expect(h.transport).not.toHaveBeenCalled();
    await h.advance(1);
    expect(h.requests).toEqual([{ visitId: "visit-1", expectedVersion: 0, patch: { clinical_notes: "first line" }, clientRequestId: "req-1" }]);
    expect(h.saver.getState()).toMatchObject({ saveState: "saved", version: 1, unsaved: false });
    expect(h.saver.getState().savedAt).not.toBeNull();
  });

  it("typing does not push the wait back: a change every second for 12 s saves at 5 s and at about 10 s", async () => {
    const h = harness();
    let text = "";
    for (let second = 1; second <= 12; second++) {
      text += "x";
      h.saver.update({ clinical_notes: text });
      await h.advance(1_000);
    }
    expect(h.requests.length).toBeGreaterThanOrEqual(2);
    expect(h.requests[0].patch).toEqual({ clinical_notes: "xxxxx" });
    expect(h.requests[1].expectedVersion).toBe(1);
    expect(new Set(h.requests.map((r) => r.clientRequestId)).size).toBe(h.requests.length);
  });

  it("blur saves at once", async () => {
    const h = harness();
    h.saver.update({ advice: ["Rest"] });
    h.saver.blur();
    await h.advance(0);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].patch).toEqual({ advice: ["Rest"] });
  });

  it("the app being hidden saves at once, and a clean draft sends nothing", async () => {
    const h = harness();
    h.saver.hidden();
    await h.advance(0);
    expect(h.transport).not.toHaveBeenCalled();
    h.saver.update({ specialty: "dental" });
    h.saver.hidden();
    await h.advance(0);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].patch).toEqual({ specialty: "dental" });
  });

  it("one save in flight at a time; edits made during it go into the next one, which waits 5 s from its own first change", async () => {
    const h = harness();
    let release!: () => void;
    h.respond((request, attempt) => {
      if (attempt !== 1) return undefined;
      return new Promise<Result<DraftSaveOk>>((resolve) => {
        release = () => {
          h.server.version += 1;
          resolve({ ok: true, value: { draftVersion: h.server.version, replayed: false, started: false } });
          void request;
        };
      });
    });
    h.saver.update({ clinical_notes: "one" });
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.requests).toHaveLength(1);
    expect(h.saver.getState().saveState).toBe("saving");

    await h.advance(2_000);
    h.saver.update({ clinical_notes: "one two" });
    h.saver.blur(); // a second save is not started while one is in flight
    await h.advance(10_000);
    expect(h.requests).toHaveLength(1);

    release();
    await h.advance(0);
    // Not sent at once: the change was made during the flight, so its 5 s started then and has passed.
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]).toMatchObject({ expectedVersion: 1, patch: { clinical_notes: "one two" } });
    expect(h.saver.getState()).toMatchObject({ saveState: "saved", version: 2 });
  });

  it("each attempt has its own request id", async () => {
    const h = harness();
    h.saver.update({ clinical_notes: "a" });
    await h.saver.flush();
    h.saver.update({ clinical_notes: "ab" });
    await h.saver.flush();
    expect(h.requests.map((r) => r.clientRequestId)).toEqual(["req-1", "req-2"]);
  });

  it("changing a field back to the server's value cancels the pending save", async () => {
    const h = harness();
    h.saver.update({ clinical_notes: "typo" });
    await h.advance(2_000);
    h.saver.update({ clinical_notes: "" });
    await h.advance(60_000);
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.saver.getState().unsaved).toBe(false);
  });

  it("dispose stops the timer", async () => {
    const h = harness();
    h.saver.update({ clinical_notes: "x" });
    h.saver.dispose();
    await h.advance(60_000);
    expect(h.transport).not.toHaveBeenCalled();
  });
});

describe("draft saver: timeout, retry, offline (PWA-06b)", () => {
  it("a save with no answer in 15 s is retried once, with the same id and payload after 1 s; a late answer of the first attempt is ignored", async () => {
    const h = harness();
    let answerFirst!: () => void;
    h.respond((_request, attempt) => {
      if (attempt !== 1) return undefined;
      return new Promise<Result<DraftSaveOk>>((resolve) => {
        answerFirst = () => resolve({ ok: false, error: appError("INTERNAL") });
      });
    });
    h.saver.update({ clinical_notes: "slow" });
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.requests).toHaveLength(1);
    await h.advance(COMMAND_TIMEOUT_MS + COMMAND_RETRY_DELAY_MS);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]).toEqual(h.requests[0]);
    expect(h.saver.getState()).toMatchObject({ saveState: "saved", version: 1 });
    answerFirst(); // the stalled first request finally answers with a failure: nothing changes
    await h.advance(0);
    expect(h.saver.getState()).toMatchObject({ saveState: "saved", version: 1, error: null });
  });

  it("a thrown transport error is retried once with the same id", async () => {
    const h = harness();
    h.respond((_request, attempt) => (attempt === 1 ? Promise.reject(new Error("network")) : undefined));
    h.saver.update({ advice: ["Fluids"] });
    h.saver.blur();
    await h.advance(COMMAND_RETRY_DELAY_MS + 1);
    expect(h.requests.map((r) => r.clientRequestId)).toEqual(["req-1", "req-1"]);
    expect(h.saver.getState().saveState).toBe("saved");
  });

  it("no second automatic retry: two failed attempts leave the error state and nothing more is sent until the doctor retries", async () => {
    const h = harness();
    h.respond(() => Promise.reject(new Error("down")));
    h.saver.update({ clinical_notes: "lost?" });
    h.saver.blur();
    await h.advance(COMMAND_RETRY_DELAY_MS + 1);
    expect(h.requests).toHaveLength(2);
    expect(h.saver.getState()).toMatchObject({ saveState: "error", unsaved: true });
    await h.advance(120_000);
    expect(h.requests).toHaveLength(2);
  });

  it("after a failure the next save re-sends exactly that attempt (same id, same payload) even if the draft changed; the newer edits go in the one after", async () => {
    const h = harness();
    let down = true;
    h.respond(() => (down ? Promise.reject(new Error("down")) : undefined));
    h.saver.update({ clinical_notes: "first" });
    h.saver.blur();
    await h.advance(COMMAND_RETRY_DELAY_MS + 1);
    expect(h.saver.getState().saveState).toBe("error");

    down = false;
    h.saver.update({ clinical_notes: "first and more" });
    const result = await h.saver.flush();
    expect(result).toEqual({ ok: true });
    const sent = h.requests.slice(2);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ clientRequestId: "req-1", expectedVersion: 0, patch: { clinical_notes: "first" } });
    expect(sent[1]).toMatchObject({ clientRequestId: "req-2", expectedVersion: 1, patch: { clinical_notes: "first and more" } });
    expect(h.server.fields.clinical_notes).toBe("first and more");
  });

  it("a definite refusal is not retried and the attempt is dropped; the next edit sends a fresh request", async () => {
    const h = harness();
    h.respond((_request, attempt) => (attempt === 1 ? Promise.resolve({ ok: false, error: appError("VALIDATION_FAILED") }) : undefined));
    h.saver.update({ clinical_notes: "bad" });
    h.saver.blur();
    await h.advance(COMMAND_RETRY_DELAY_MS + 1);
    expect(h.requests).toHaveLength(1);
    expect(h.saver.getState()).toMatchObject({ saveState: "error" });
    h.saver.update({ clinical_notes: "good" });
    expect((await h.saver.flush()).ok).toBe(true);
    expect(h.requests[1].clientRequestId).toBe("req-2");
  });

  it("offline at save time sends nothing and shows offline; the online event saves", async () => {
    const h = harness({ online: false });
    h.saver.update({ clinical_notes: "typed offline" });
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.saver.getState()).toMatchObject({ saveState: "offline", unsaved: true });
    h.setOnline(true);
    h.saver.online();
    await h.advance(0);
    expect(h.requests).toHaveLength(1);
    expect(h.saver.getState()).toMatchObject({ saveState: "saved", unsaved: false });
  });
});

describe("draft saver: conflicts (R-5)", () => {
  it("a field only the other writer changed does not stop the save: the saver rebases, shows what arrived, and re-sends at the new version", async () => {
    const h = harness();
    h.otherWriter({ advice: ["Their advice"] });
    h.saver.update({ clinical_notes: "my note" });
    const result = await h.saver.flush();
    expect(result).toEqual({ ok: true });
    expect(h.requests).toHaveLength(2);
    expect(h.requests[0]).toMatchObject({ expectedVersion: 0 });
    expect(h.requests[1]).toMatchObject({ expectedVersion: 1, patch: { clinical_notes: "my note" } });
    expect(h.requests[1].clientRequestId).not.toBe(h.requests[0].clientRequestId);
    expect(h.rebased).toEqual([{ advice: ["Their advice"] }]);
    expect(h.server.fields).toMatchObject({ clinical_notes: "my note", advice: ["Their advice"] });
    expect(h.saver.getDraft()).toMatchObject({ clinical_notes: "my note", advice: ["Their advice"] });
    expect(h.saver.getState().conflict).toBeNull();
  });

  it("the same field changed to different values stops the saver with the conflict; nothing is sent until the doctor chooses", async () => {
    const h = harness();
    h.otherWriter({ clinical_notes: "their note" });
    h.saver.update({ clinical_notes: "my note" });
    const result = await h.saver.flush();
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
    expect(h.saver.getState().conflict).toMatchObject({ fields: ["clinical_notes"] });
    expect(h.requests).toHaveLength(1);
    await h.advance(60_000);
    expect(h.requests).toHaveLength(1);
    expect((await h.saver.flush()).ok).toBe(false);
  });

  it("'Use the other version': the other copy replaces mine for the overlapping fields and nothing more is sent", async () => {
    const h = harness();
    h.otherWriter({ clinical_notes: "their note" });
    h.saver.update({ clinical_notes: "my note" });
    await h.saver.flush();
    const result = await h.saver.resolveConflict("theirs");
    expect(result).toEqual({ ok: true });
    expect(h.rebased).toContainEqual({ clinical_notes: "their note" });
    expect(h.saver.getDraft().clinical_notes).toBe("their note");
    expect(h.requests).toHaveLength(1);
    expect(h.server.fields.clinical_notes).toBe("their note");
  });

  it("'Keep mine': re-sent at the new version with the overwrite flag, once", async () => {
    const h = harness();
    h.otherWriter({ clinical_notes: "their note" });
    h.saver.update({ clinical_notes: "my note", advice: ["Mine"] });
    await h.saver.flush();
    const result = await h.saver.resolveConflict("mine");
    expect(result).toEqual({ ok: true });
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]).toMatchObject({ expectedVersion: 1, patch: { clinical_notes: "my note", advice: ["Mine"], conflict_overwrite: true } });
    expect(h.server.fields.clinical_notes).toBe("my note");
    // The flag belongs to that one save.
    h.saver.update({ clinical_notes: "my note, edited" });
    await h.saver.flush();
    expect(h.requests[2].patch).not.toHaveProperty("conflict_overwrite");
  });

  it("when both changed the same field to the same value there is no prompt", async () => {
    const h = harness();
    h.otherWriter({ specialty: "dental" });
    h.saver.update({ specialty: "dental", advice: ["Mine"] });
    const result = await h.saver.flush();
    expect(result).toEqual({ ok: true });
    expect(h.saver.getState().conflict).toBeNull();
    expect(h.requests[1].patch).toEqual({ advice: ["Mine"] });
  });

  it("a server copy that cannot be read leaves the error state with the draft intact", async () => {
    const h = harness();
    h.otherWriter({ clinical_notes: "their note" });
    h.failReadServer();
    h.saver.update({ clinical_notes: "my note" });
    const result = await h.saver.flush();
    expect(result).toMatchObject({ ok: false, reason: "error" });
    expect(h.saver.getDraft().clinical_notes).toBe("my note");
    expect(h.saver.getState().saveState).toBe("error");
  });

  it("a visit the server now refuses (signed elsewhere) stops the saver as locked, and the draft is kept", async () => {
    const h = harness();
    h.server.signedAt = "2031-01-01T10:00:00Z";
    h.server.status = "completed";
    h.saver.update({ clinical_notes: "too late" });
    const result = await h.saver.flush();
    expect(result).toMatchObject({ ok: false, reason: "locked" });
    expect(h.saver.getState()).toMatchObject({ locked: true, saveState: "error" });
    await h.advance(60_000);
    expect(h.requests).toHaveLength(1);
    expect(h.saver.getDraft().clinical_notes).toBe("too late");
  });
});

describe("draft saver: flush", () => {
  it("resolves at once when nothing is unsaved", async () => {
    const h = harness();
    expect(await h.saver.flush()).toEqual({ ok: true });
    expect(h.transport).not.toHaveBeenCalled();
  });

  it("waits for the save in flight, then sends what changed meanwhile, and resolves ok only when everything is saved", async () => {
    const h = harness();
    let release!: () => void;
    h.respond((_request, attempt) =>
      attempt === 1
        ? new Promise<Result<DraftSaveOk>>((resolve) => {
            release = () => {
              h.server.version += 1;
              resolve({ ok: true, value: { draftVersion: h.server.version, replayed: false, started: false } });
            };
          })
        : undefined,
    );
    h.saver.update({ clinical_notes: "one" });
    h.saver.blur();
    await h.advance(0);
    h.saver.update({ clinical_notes: "one two" });
    const done = h.saver.flush();
    await h.advance(0);
    expect(h.requests).toHaveLength(1);
    release();
    expect(await done).toEqual({ ok: true });
    expect(h.requests).toHaveLength(2);
    expect(h.server.fields.clinical_notes).toBe("one two");
    expect(h.saver.getState().unsaved).toBe(false);
  });

  it("reports why it could not save: error, offline", async () => {
    const h = harness();
    h.respond(() => Promise.reject(new Error("down")));
    h.saver.update({ clinical_notes: "x" });
    const failed = h.saver.flush();
    await h.advance(COMMAND_RETRY_DELAY_MS + 1);
    expect(await failed).toMatchObject({ ok: false, reason: "error" });

    const o = harness({ online: false });
    o.saver.update({ clinical_notes: "x" });
    expect(await o.saver.flush()).toEqual({ ok: false, reason: "offline" });
  });

  it("the unload guard state: unsaved is true from the first change until the save lands", async () => {
    const h = harness();
    expect(h.saver.getState().unsaved).toBe(false);
    h.saver.update({ clinical_notes: "x" });
    expect(h.saver.getState().unsaved).toBe(true);
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.saver.getState().unsaved).toBe(false);
    expect(h.states.some((s) => s.saveState === "saving")).toBe(true);
  });
});

describe("draft saver: 09B-06a review fixes", () => {
  it("A-1: release() saves what is unsent at once (no wait for the timer), reports nothing more to the screen, then stops", async () => {
    const h = harness();
    h.saver.update({ chief_complaints: [{ symptom: "Fever" }] });
    h.saver.update({ chief_complaints: [{ symptom: "Fever" }, { symptom: "Cough" }] });
    expect(h.requests).toHaveLength(0);
    const statesBefore = h.states.length;
    const done = h.saver.release();
    await h.advance(1);
    expect(await done).toEqual({ ok: true });
    expect(h.requests).toHaveLength(1);
    expect(h.server.fields.chief_complaints).toEqual([{ symptom: "Fever" }, { symptom: "Cough" }]);
    expect(h.states.length).toBe(statesBefore);
    // Released: a later edit is ignored and no timer runs.
    h.saver.update({ clinical_notes: "after leaving" });
    await h.advance(DRAFT_MAX_WAIT_MS * 2);
    expect(h.requests).toHaveLength(1);
  });

  it("A-1: release() with nothing unsent sends nothing", async () => {
    const h = harness();
    expect(await h.saver.release()).toEqual({ ok: true });
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.requests).toHaveLength(0);
  });

  it("A-7: an out-of-range vital is held back and the other dirty fields are saved; flush says invalid; corrected, it is sent", async () => {
    const h = harness();
    h.saver.update({ vitals: { spo2: 9 }, clinical_notes: "typed while the SpO2 is half entered" });
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.requests).toHaveLength(1);
    expect(Object.keys(h.requests[0].patch)).toEqual(["clinical_notes"]);
    expect(h.server.fields.clinical_notes).toBe("typed while the SpO2 is half entered");
    expect(h.server.fields.vitals).toBeNull();
    const state = h.saver.getState();
    expect(state.saveState).toBe("saved");
    expect(state.invalidFields).toEqual(["vitals"]);
    expect(state.unsaved).toBe(true);
    expect(await h.saver.flush()).toEqual({ ok: false, reason: "invalid" });
    // Nothing loops: no request is made while only the held-back field is dirty.
    await h.advance(DRAFT_MAX_WAIT_MS * 3);
    expect(h.requests).toHaveLength(1);

    h.saver.update({ vitals: { spo2: 98 } });
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].patch).toEqual({ vitals: { spo2: 98 } });
    expect(h.saver.getState().invalidFields).toEqual([]);
    expect(await h.saver.flush()).toEqual({ ok: true });
  });

  it("A-7: systolic not above diastolic and a fractional pulse are held back too", async () => {
    const h = harness();
    h.saver.update({ vitals: { systolic: 80, diastolic: 90 } });
    h.saver.blur();
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.requests).toHaveLength(0);
    h.saver.update({ vitals: { pulse: 72.5 } });
    await h.advance(DRAFT_MAX_WAIT_MS);
    expect(h.requests).toHaveLength(0);
    expect(h.saver.getState().invalidFields).toEqual(["vitals"]);
  });
});
