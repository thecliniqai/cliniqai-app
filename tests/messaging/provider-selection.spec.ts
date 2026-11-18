/**
 * V2-03 03-01 (P1-15, R-16): messaging provider selection has no fallback, and the `disabled` provider sends nothing.
 *
 * Before 03-01, `MESSAGING_PROVIDER=msg91` without `MSG91_AUTH_KEY` "seamlessly" became the dev logger, which prints
 * recipients and template parameters. Now the env schema refuses it.
 *
 * V2-04 04-03a (R-20, 03-01 handover; pitfall 9 rewrite): the inline dispatcher is gone. The `message.send` handler
 * dead-letters a `disabled` refusal at once (before: `failed`, retried to `dead_letter` while sending nothing) and
 * queues no SMS fallback; a retryable failure still queues one (DB lane: local stack, synthetic tenant and phone).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EnvConfigError } from "@/lib/env";
import {
  DevLoggerProvider,
  DisabledMessagingProvider,
  Msg91Provider,
  PROVIDER_DISABLED,
  SinkProvider,
  getMessagingProvider,
  type MessagingProvider,
} from "@/lib/messaging";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { letters } from "../jobs/helpers";
import { onlyFor, queueState, runMessages, seedPatient, type SeededPatient } from "../jobs/message-helpers";

const DEV_MESSAGES = path.join(process.cwd(), ".planning", "dev-messages.txt");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("provider selection (no fallback)", () => {
  it("MESSAGING_PROVIDER=msg91 without MSG91_AUTH_KEY throws instead of yielding the dev provider", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "msg91");
    vi.stubEnv("MSG91_AUTH_KEY", undefined);
    let provider: MessagingProvider | null = null;
    let error: unknown = null;
    try {
      provider = getMessagingProvider();
    } catch (e) {
      error = e;
    }
    expect(provider).toBeNull();
    expect(error).toBeInstanceOf(EnvConfigError);
    expect((error as EnvConfigError).issues).toContain("MSG91_AUTH_KEY: required when MESSAGING_PROVIDER=msg91");
  });

  it("MESSAGING_PROVIDER=msg91 with its key yields the msg91 provider", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "msg91");
    vi.stubEnv("MSG91_AUTH_KEY", "x");
    expect(getMessagingProvider()).toBeInstanceOf(Msg91Provider);
  });

  it("MESSAGING_PROVIDER=disabled yields the disabled provider; sink the sink; dev stays the dev logger", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "disabled");
    expect(getMessagingProvider()).toBeInstanceOf(DisabledMessagingProvider);
    vi.stubEnv("MESSAGING_PROVIDER", "sink");
    expect(getMessagingProvider()).toBeInstanceOf(SinkProvider);
    vi.stubEnv("MESSAGING_PROVIDER", "dev");
    expect(getMessagingProvider()).toBeInstanceOf(DevLoggerProvider);
  });

  it("an unknown provider name throws (no default)", () => {
    expect(() => getMessagingProvider("carrier-pigeon")).toThrow("Unknown messaging provider");
  });
});

describe("the disabled provider (R-16)", () => {
  it("sends nothing, logs nothing, writes no file and returns a non-retryable failure", async () => {
    fs.rmSync(DEV_MESSAGES, { force: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logSpy = vi.spyOn(console, "log");
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const provider: MessagingProvider = new DisabledMessagingProvider();

    const sms = await provider.sendSms("+919800000001", "appointment_booked", { patient_name: "Synthetic" });
    const wa = await provider.sendWhatsApp("+919800000001", "appointment_booked", { patient_name: "Synthetic" });

    expect(sms).toEqual({ success: false, channelUsed: "sms", error: PROVIDER_DISABLED, code: PROVIDER_DISABLED, retryable: false });
    expect(wa).toEqual({ success: false, channelUsed: "whatsapp", error: PROVIDER_DISABLED, code: PROVIDER_DISABLED, retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    // The dev provider logs through lib/log (03-09c): the disabled one must not write its line either.
    expect(stdoutSpy.mock.calls.map((call) => String(call[0])).join("")).not.toContain("messaging.dev.recorded");
    expect(fs.existsSync(DEV_MESSAGES)).toBe(false);
  });
});

describe("message.send with the disabled provider (DB lane)", () => {
  const admin = getAdminClient();
  const WORKER = `spec-provsel-${letters(8)}`;
  let tenant: SeededTenant;
  let patient: SeededPatient;

  beforeAll(async () => {
    tenant = await seedTenantWithOwner("Provider selection clinic");
    patient = await seedPatient(tenant.tenantId, tenant.userId);
  }, 60_000);

  afterAll(() => {
    fs.rmSync(DEV_MESSAGES, { force: true });
  });

  async function queueWhatsAppBooking(): Promise<string> {
    const { data, error } = await admin.rpc("enqueue_message_system", {
      p_system_actor: "system:jobs",
      p_patient_id: patient.patientId,
      p_visit_id: patient.visitId,
      p_channel: "whatsapp",
      p_message_type: "appointment_booked",
      p_template_id: "appointment_booked",
      p_template_params: { patient_name: "Synthetic" },
      p_recipient_phone: null as unknown as string,
      p_recipient_user_id: null as unknown as string,
      p_metadata: {},
      p_dedupe_key: `appointment_booked:${letters(10)}`,
    });
    if (error || !data) throw new Error(`enqueue failed: ${error?.code}`);
    return (data as { id: string }).id;
  }

  async function fallbackRows(queueId: string): Promise<number> {
    const { data, error } = await admin
      .from("communication_queue")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .eq("dedupe_key", `msg-fallback:${queueId}`);
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  }

  it("dead-letters the refusal at once with provider_disabled and queues no SMS fallback", async () => {
    const id = await queueWhatsAppBooking();
    await runMessages(onlyFor(patient.phone, new DisabledMessagingProvider()), `${WORKER}-disabled`);
    expect(queueState(id)).toMatchObject({ status: "dead_letter", error: PROVIDER_DISABLED, retryCount: 0 });
    expect(await fallbackRows(id)).toBe(0);
  });

  it("control: a retryable WhatsApp failure does queue the SMS fallback (so the assertion above is live)", async () => {
    const id = await queueWhatsAppBooking();
    const failing: MessagingProvider = {
      name: "dev",
      sendSms: async () => ({ success: true, channelUsed: "sms", externalMessageId: "rec-sms" }),
      sendWhatsApp: async () => ({ success: false, channelUsed: "whatsapp", error: "synthetic_failure", retryable: true }),
    };
    await runMessages(onlyFor(patient.phone, failing), `${WORKER}-control`);
    expect(queueState(id)).toMatchObject({ status: "failed", error: "synthetic_failure" });
    expect(await fallbackRows(id)).toBe(1);
  });
});
