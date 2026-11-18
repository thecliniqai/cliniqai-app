/**
 * The D-3 preference allowlist (V2-06 06-05; PWA_STRATEGY §4 D-3): only `clinicos.pref.*` keys named in
 * `lib/pwa/device-prefs.ts` may be written; anything else is refused at write time and removed by the purge.
 */
import { describe, expect, it } from "vitest";
import { DEVICE_PREF_KEYS, isDevicePrefKey, readDevicePref, writeDevicePref, type DevicePrefKey } from "@/lib/pwa/device-prefs";

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
}

describe("device preferences (D-3)", () => {
  it("are exactly the four clinicos.pref.* keys", () => {
    expect([...DEVICE_PREF_KEYS].sort()).toEqual([
      "clinicos.pref.density",
      "clinicos.pref.installDismissedUntil",
      "clinicos.pref.lastLane",
      "clinicos.pref.signedInSessions",
    ]);
  });

  it.each([
    ["clinicos.pref.density", true],
    ["clinicos.pref.lastLane", true],
    ["clinicos.pref.", false],
    ["clinicos.pref.patientId", false],
    ["clinicos.pref.density.x", false],
    ["sb-127-auth-token", false],
    ["supabase.auth.token", false],
    ["", false],
  ])("isDevicePrefKey(%j) → %s", (key, expected) => {
    expect(isDevicePrefKey(key)).toBe(expected);
  });

  it("writes and reads a known key; refuses an unknown key at run time", () => {
    const storage = memory();
    writeDevicePref("clinicos.pref.density", "compact", storage);
    expect(readDevicePref("clinicos.pref.density", storage)).toBe("compact");
    expect(() => writeDevicePref("clinicos.pref.patientId" as DevicePrefKey, "x", storage)).toThrow(/not a device preference key/);
    expect(storage.length).toBe(1);
  });

  it("a blocked or full storage is ignored (read null, write no-op)", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;
    expect(readDevicePref("clinicos.pref.lastLane", broken)).toBeNull();
    expect(() => writeDevicePref("clinicos.pref.lastLane", "waiting", broken)).not.toThrow();
  });
});
