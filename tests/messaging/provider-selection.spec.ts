/**
 * V2-03 03-01 (P1-15, R-16): messaging provider selection has no fallback, and the `disabled` provider sends nothing.
 *
 * Before 03-01, `MESSAGING_PROVIDER=msg91` without `MSG91_AUTH_KEY` "seamlessly" became the dev logger, which prints
 * recipients and template parameters. Now the env schema refuses it. The dispatcher records a `disabled` refusal with
 * the existing status set and queues no SMS fallback (DB lane: local stack, synthetic tenant and phone).
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
  getMessagingProvider,
  type MessagingProvider,
} from "@/lib/messaging";
import { dispatchQueuedMessage } from "@/lib/messaging/dispatcher";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

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

  it("MESSAGING_PROVIDER=disabled yields the disabled provider; dev stays the dev logger", () => {
    vi.stubEnv("MESSAGING_PROVIDER", "disabled");
    expect(getMessagingProvider()).toBeInstanceOf(DisabledMessagingProvider);
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

    expect(sms).toEqual({ success: false, channelUsed: "sms", error: PROVIDER_DISABLED, retryable: false });
    expect(wa).toEqual({ success: false, channelUsed: "whatsapp", error: PROVIDER_DISABLED, retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    // The dev provider logs through lib/log (03-09c): the disabled one must not write its line either.
    expect(stdoutSpy.mock.calls.map((call) => String(call[0])).join("")).not.toContain("messaging.dev.recorded");
    expect(fs.existsSync(DEV_MESSAGES)).toBe(false);
  });
});

describe("dispatcher with the disabled provider (DB lane)", () => {
  const admin = getAdminClient();
  let tenant: SeededTenant;

  beforeAll(async () => {
    tenant = await seedTenantWithOwner("Provider selection clinic");
  }, 60_000);

  afterAll(() => {
    // The control's fallback row is sent at once through the lane's dev logger, which appends to this file.
    fs.rmSync(DEV_MESSAGES, { force: true });
  });

  async function queueWhatsAppBooking(): Promise<string> {
    const { data, error } = await admin
      .from("communication_queue")
      .insert({
        tenant_id: tenant.tenantId,
        channel: "whatsapp",
        message_type: "appointment_booked",
        template_id: "appointment_booked",
        template_params: { patient_name: "Synthetic" },
        recipient_phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        next_retry_at: new Date(Date.now() - 1000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed queue row failed: ${error?.message}`);
    return data.id;
  }

  async function fallbackRows(): Promise<number> {
    const { data, error } = await admin
      .from("communication_queue")
      .select("id, metadata")
      .eq("tenant_id", tenant.tenantId)
      .eq("channel", "sms");
    if (error) throw new Error(error.message);
    return (data ?? []).filter((r) => (r.metadata as Record<string, unknown> | null)?.is_sms_fallback === true).length;
  }

  it("records the refusal as failed with provider_disabled and queues no SMS fallback", async () => {
    const id = await queueWhatsAppBooking();
    const outcome = await dispatchQueuedMessage(admin, id, { provider: new DisabledMessagingProvider() });
    expect(outcome).toBe("failed");

    const { data: row } = await admin.from("communication_queue").select("status, error_message").eq("id", id).single();
    expect(row).toEqual({ status: "failed", error_message: PROVIDER_DISABLED });
    expect(await fallbackRows()).toBe(0);
  });

  it("control: a retryable WhatsApp failure does queue the SMS fallback (so the assertion above is live)", async () => {
    const id = await queueWhatsAppBooking();
    const failing: MessagingProvider = {
      name: "dev",
      sendSms: async () => ({ success: false, channelUsed: "sms", error: "synthetic_failure" }),
      sendWhatsApp: async () => ({ success: false, channelUsed: "whatsapp", error: "synthetic_failure" }),
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await dispatchQueuedMessage(admin, id, { provider: failing })).toBe("failed");
    expect(await fallbackRows()).toBe(1);
  });
});
