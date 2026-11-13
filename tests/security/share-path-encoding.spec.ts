/**
 * V2-01 plan 01-09, AR2-H1 (reviews/review2-adversarial.md H1): a stored key with percent-encoded dot segments passed
 * the share-link signer's prefix check, and the URL parser in the storage client collapsed `%2e%2e` into `..`, so the
 * service role signed another tenant's object. App side: `signSharedObject` and every storage helper refuse such a key
 * before any provider call. Pure unit tests: the service-role client is replaced by a fake, no database or network.
 * (The database side is in tests/security/review2-fixes-db.spec.ts.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as systemDb from "@/lib/supabase/system";
import { isTenantStoragePath, signSharedObject } from "@/features/sharing/system";
import { getSignedUrl, validateStoragePath, type StorageProvider } from "@/lib/storage";
import { isPatientStoragePath, isWellFormedStorageKey } from "@/lib/storage/tenant-path";
import { formatAmendedFilename } from "@/features/labs/utils";

const TENANT_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const PATIENT_P = "0b0b0b0b-0000-4000-8000-00000000000b";
const TENANT_B = "0c0c0c0c-0000-4000-8000-00000000000c";
const VISIT_B = "0d0d0d0d-0000-4000-8000-00000000000d";
const TOKEN = "f".repeat(64);

/** The exact payload shape from the report: five encoded `..` segments out of A's patient prefix into B's Rx. */
const H1_PAYLOAD = `tenants/${TENANT_A}/patients/${PATIENT_P}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/prescriptions/${TENANT_B}/${VISIT_B}/rx_v1.pdf`;
const VARIANTS = [
  H1_PAYLOAD,
  `tenants/${TENANT_A}/patients/${PATIENT_P}/.%2e/.%2e/x.pdf`,
  `tenants/${TENANT_A}/patients/${PATIENT_P}/%2e./x.pdf`,
  `tenants/${TENANT_A}/patients/${PATIENT_P}/%2E%2E/x.pdf`,
  `tenants/${TENANT_A}/patients/${PATIENT_P}/%252e%252e/x.pdf`,
  `tenants/${TENANT_A}/patients/${PATIENT_P}/..%2fx.pdf`,
  `tenants/${TENANT_A}/patients/${PATIENT_P}/a%5c..%5cx.pdf`,
  `tenants/${TENANT_A}/patients/${PATIENT_P}/./x.pdf`,
  `tenants/${TENANT_A}/patients/${PATIENT_P}/a b.pdf`,
];

function fakeAdmin(storagePath: string) {
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "http://127.0.0.1:9/signed?token=syn" }, error: null }));
  const client = {
    rpc: vi.fn(async (name: string) => {
      if (name !== "share_token_object") return { data: null, error: null };
      return {
        data: {
          tenant_id: TENANT_A,
          resource_type: "patient_document",
          resource_id: "0e0e0e0e-0000-4000-8000-00000000000e",
          bucket: "clinic-records",
          storage_path: storagePath,
          original_filename: "report.pdf",
        },
        error: null,
      };
    }),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
  };
  return { client, createSignedUrl };
}

describe("AR2-H1: encoded dot segments never reach the storage signer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("control: a well-formed key under the token's tenant is signed", async () => {
    const { client, createSignedUrl } = fakeAdmin(`tenants/${TENANT_A}/patients/${PATIENT_P}/labs/report_2026-10-22.pdf`);
    vi.spyOn(systemDb, "getSystemDb").mockReturnValue(client as never);
    const res = await signSharedObject(TOKEN, ["patient_document"]);
    expect(res?.signedUrl).toContain("signed");
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it.each(VARIANTS)("signSharedObject refuses %s without calling storage", async (path) => {
    const { client, createSignedUrl } = fakeAdmin(path);
    vi.spyOn(systemDb, "getSystemDb").mockReturnValue(client as never);
    expect(await signSharedObject(TOKEN, ["patient_document"])).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it.each(VARIANTS)("the key checks refuse %s", (path) => {
    expect(isWellFormedStorageKey(path)).toBe(false);
    expect(isTenantStoragePath(TENANT_A, path)).toBe(false);
    expect(isPatientStoragePath(TENANT_A, PATIENT_P, path)).toBe(false);
    expect(() => validateStoragePath(path)).toThrow(/traversal/i);
  });

  it("getSignedUrl refuses the payload before the provider is called (R2 or any other provider)", async () => {
    const provider: StorageProvider = {
      name: "mock",
      upload: vi.fn(),
      createSignedUrl: vi.fn(async () => ({ signedUrl: "x" })),
      delete: vi.fn(),
      download: vi.fn(),
    };
    await expect(getSignedUrl({ path: H1_PAYLOAD, bucket: "clinic-records" }, provider)).rejects.toThrow(/traversal/i);
    expect(provider.createSignedUrl).not.toHaveBeenCalled();
  });

  it("lab upload keys are always well-formed, whatever the uploaded file's name and extension", () => {
    for (const name of ["scan.p%2e%2edf", "x.pd f", "x.पीडीएफ", "noext", "a.b.c/../d.pdf"]) {
      const key = `tenants/${TENANT_A}/patients/${PATIENT_P}/labs/${formatAmendedFilename("Synthetic Patient", name, "2026-10-22")}`;
      expect(isPatientStoragePath(TENANT_A, PATIENT_P, key), key).toBe(true);
    }
  });
});
