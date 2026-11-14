/**
 * The only `localStorage` keys the app may write (PWA_STRATEGY §4 D-3; V2-06 06-05). Per-device preferences, never
 * an identifier and never patient data. `purgeDeviceState()` (`lib/pwa/purge.ts`) removes every other key on each
 * sign-out, and the cache-audit e2e spec fails on any other key after browsing.
 *
 * Adding a key: add it here with its reason and its value shape, and keep the value non-identifying.
 */
export const DEVICE_PREF_KEYS = [
  /** Install card dismissed until this epoch-ms instant (PWA §6.1, 06-06). */
  "clinicos.pref.installDismissedUntil",
  /** How many browser sessions have signed in on this device: a number, for the install card's "second session" rule (R-36). */
  "clinicos.pref.signedInSessions",
  /** List density (compact/comfortable), DESIGN_SYSTEM. */
  "clinicos.pref.density",
  /** Last selected Today lane (a lane id such as "waiting"; never a patient or visit id). */
  "clinicos.pref.lastLane",
] as const;

export type DevicePrefKey = (typeof DEVICE_PREF_KEYS)[number];

const KEYS: ReadonlySet<string> = new Set(DEVICE_PREF_KEYS);

export function isDevicePrefKey(key: string): key is DevicePrefKey {
  return KEYS.has(key);
}

/** The value of a preference, or null (no value, storage unavailable, or blocked by the browser). */
export function readDevicePref(key: DevicePrefKey, storage: Storage | undefined = browserLocalStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores a preference; a full or blocked storage is ignored (preferences are best effort). */
export function writeDevicePref(key: DevicePrefKey, value: string, storage: Storage | undefined = browserLocalStorage()): void {
  if (!isDevicePrefKey(key)) throw new Error("not a device preference key");
  try {
    storage?.setItem(key, value);
  } catch {
    // Quota exceeded or storage disabled: the preference is simply not kept.
  }
}

function browserLocalStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
