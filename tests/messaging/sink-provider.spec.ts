/**
 * V2-04 04-03a (R-9): `MESSAGING_PROVIDER=sink` (staging, the e2e lane) runs the queue and the runner but sends
 * nothing. Every send succeeds with a `sink-<uuid>` id, makes no network call (a `fetch` spy sees 0 calls), writes no
 * file, and its one log line carries no recipient, template or parameter.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMessagingProvider, SinkProvider, type MessagingProvider } from "@/lib/messaging";

const PHONE = "+919000000077"; // synthetic range
const DEV_FILE = path.resolve(__dirname, "../../.planning/dev-messages.txt");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("SinkProvider", () => {
  it("succeeds with a sink id, calls no network, writes no file and logs no message data", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    const existed = fs.existsSync(DEV_FILE);
    const before = existed ? fs.statSync(DEV_FILE).size : -1;

    const provider: MessagingProvider = new SinkProvider();
    const wa = await provider.sendWhatsApp(PHONE, "appointment_booked", { patient_name: "Synthetic Sink Patient" });
    const sms = await provider.sendSms(PHONE, "appointment_booked_sms_fallback", { patient_name: "Synthetic Sink Patient" });

    expect(wa).toMatchObject({ success: true, channelUsed: "whatsapp" });
    expect(sms).toMatchObject({ success: true, channelUsed: "sms" });
    for (const r of [wa, sms]) expect(r.externalMessageId).toMatch(/^sink-[0-9a-f-]{36}$/);
    expect(wa.externalMessageId).not.toBe(sms.externalMessageId);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(DEV_FILE) ? fs.statSync(DEV_FILE).size : -1).toBe(before);

    const text = out.join("");
    expect(text).toContain('"event":"messaging.sink.recorded"');
    for (const secret of ["9000000077", "Synthetic Sink Patient", "appointment_booked"]) expect(text).not.toContain(secret);
  });

  it("is what MESSAGING_PROVIDER=sink selects", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "sink");
    const provider = getMessagingProvider();
    expect(provider).toBeInstanceOf(SinkProvider);
    expect(provider.name).toBe("sink");
  });
});
