/**
 * V2-03 03-02 (ADR-0005 D2 "Request-path code never falls back to the service role on error", T-03-01): when the
 * cookie client cannot be created, the storage provider rejects. Before 03-02 it built a second service-role client
 * from `SUPABASE_SECRET_KEY` and carried on (the fifth factory of ADR-0005).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, supabaseJsCreateClient } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  supabaseJsCreateClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock, createPublicClient: vi.fn() }));
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  supabaseJsCreateClient.mockImplementation(actual.createClient);
  return { ...actual, createClient: supabaseJsCreateClient };
});

import { SupabaseStorageProvider } from "@/lib/storage";

describe("SupabaseStorageProvider without a request scope", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createClientMock.mockRejectedValue(new Error("cookies() called outside a request scope"));
    supabaseJsCreateClient.mockClear();
    // The secret key is present (as on every deployment); it must still not be used.
    vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-secret-key-for-fallback-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["createSignedUrl", (p: SupabaseStorageProvider) => p.createSignedUrl({ path: "tenants/t/x.pdf" })],
    ["download", (p: SupabaseStorageProvider) => p.download({ path: "tenants/t/x.pdf" })],
    ["delete", (p: SupabaseStorageProvider) => p.delete({ path: "tenants/t/x.pdf" })],
    [
      "upload",
      (p: SupabaseStorageProvider) =>
        p.upload({ path: "tenants/t/x.pdf", buffer: Buffer.from("synthetic"), contentType: "application/pdf" }),
    ],
  ])("%s rejects and creates no client of its own", async (_name, call) => {
    const provider = new SupabaseStorageProvider();
    await expect(call(provider)).rejects.toThrow("Could not initialize Supabase client for storage");
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(supabaseJsCreateClient).not.toHaveBeenCalled();
  });

  it("control: an injected client is used and the cookie client is never asked for", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "http://127.0.0.1:9/signed" }, error: null }));
    const client = { storage: { from: vi.fn(() => ({ createSignedUrl })) } };
    const provider = new SupabaseStorageProvider({ client: client as never });
    await expect(provider.createSignedUrl({ path: "tenants/t/x.pdf" })).resolves.toEqual({
      signedUrl: "http://127.0.0.1:9/signed",
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
