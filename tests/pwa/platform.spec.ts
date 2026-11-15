/**
 * V2-06 06-06 (PWA_STRATEGY §6.1-§6.3): install-path detection (`lib/pwa/platform.ts`) over a user-agent table, the
 * Android `intent://` link, and the Today card's rules (`lib/pwa/install.ts`). User agents are representative public
 * strings (no device of a person).
 */
import { describe, expect, it } from "vitest";
import {
  chromeIntentUrl,
  installMode,
  isAndroid,
  isInAppBrowser,
  isIos,
  isIpadOs,
  isStandalone,
  type InstallContext,
} from "@/lib/pwa/platform";
import {
  countSignedInSession,
  DISMISS_MS,
  DISMISSED_UNTIL_KEY,
  dismissInstallCard,
  installCardVisible,
  SESSION_COUNT_KEY,
  signedInSessionCount,
} from "@/lib/pwa/install";

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  whatsappAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 WhatsApp/2.24",
  whatsappIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
  gmailGsa: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0 Mobile/15E148 Safari/604.1",
  androidWebView: "Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36",
  facebook: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 [FBAN/EMA;FBAV/400.0]",
  desktopChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

function ctx(ua: string, over: Partial<InstallContext> = {}): InstallContext {
  return { ua, maxTouchPoints: 0, standalone: false, canPrompt: false, installed: false, ...over };
}

describe("platform detection (UA table)", () => {
  it.each([
    ["androidChrome", UA.androidChrome, 5, { ios: false, ipad: false, inApp: false, android: true }],
    ["samsung", UA.samsung, 5, { ios: false, ipad: false, inApp: false, android: true }],
    ["iphoneSafari", UA.iphoneSafari, 5, { ios: true, ipad: false, inApp: false, android: false }],
    ["ipadAsMac (maxTouchPoints 5)", UA.ipadAsMac, 5, { ios: false, ipad: true, inApp: false, android: false }],
    ["macDesktop (maxTouchPoints 0)", UA.macDesktop, 0, { ios: false, ipad: false, inApp: false, android: false }],
    ["whatsappAndroid", UA.whatsappAndroid, 5, { ios: false, ipad: false, inApp: true, android: true }],
    ["whatsappIos", UA.whatsappIos, 5, { ios: true, ipad: false, inApp: true, android: false }],
    ["instagram", UA.instagram, 5, { ios: true, ipad: false, inApp: true, android: false }],
    ["gmailGsa", UA.gmailGsa, 5, { ios: true, ipad: false, inApp: true, android: false }],
    ["androidWebView", UA.androidWebView, 5, { ios: false, ipad: false, inApp: true, android: true }],
    ["facebook", UA.facebook, 5, { ios: false, ipad: false, inApp: true, android: true }],
  ] as const)("%s", (_name, ua, touch, expected) => {
    expect({ ios: isIos(ua), ipad: isIpadOs(ua, touch), inApp: isInAppBrowser(ua), android: isAndroid(ua) }).toEqual(expected);
  });

  it("installMode per device", () => {
    expect(installMode(ctx(UA.androidChrome, { canPrompt: true }))).toBe("prompt");
    expect(installMode(ctx(UA.androidChrome))).toBe("none");
    expect(installMode(ctx(UA.desktopChrome, { canPrompt: true }))).toBe("prompt");
    expect(installMode(ctx(UA.iphoneSafari, { maxTouchPoints: 5 }))).toBe("ios-sheet");
    expect(installMode(ctx(UA.ipadAsMac, { maxTouchPoints: 5 }))).toBe("ios-sheet");
    // An iPad never gets the Android prompt path, even if an event were held.
    expect(installMode(ctx(UA.ipadAsMac, { maxTouchPoints: 5, canPrompt: true }))).toBe("ios-sheet");
    expect(installMode(ctx(UA.macDesktop))).toBe("none");
    expect(installMode(ctx(UA.whatsappIos, { maxTouchPoints: 5 }))).toBe("open-in-safari");
    expect(installMode(ctx(UA.whatsappAndroid, { maxTouchPoints: 5, canPrompt: true }))).toBe("open-in-chrome");
    expect(installMode(ctx(UA.gmailGsa, { maxTouchPoints: 5 }))).toBe("open-in-safari");
    expect(installMode(ctx(UA.androidWebView))).toBe("open-in-chrome");
  });

  it("standalone or installed: no entry anywhere", () => {
    for (const ua of Object.values(UA)) {
      expect(installMode(ctx(ua, { standalone: true, canPrompt: true, maxTouchPoints: 5 }))).toBe("none");
      expect(installMode(ctx(ua, { installed: true, canPrompt: true, maxTouchPoints: 5 }))).toBe("none");
    }
  });

  it("isStandalone: navigator.standalone (iOS) or display-mode: standalone", () => {
    expect(isStandalone({ standalone: true }, () => ({ matches: false }))).toBe(true);
    expect(isStandalone({}, (q) => ({ matches: q === "(display-mode: standalone)" }))).toBe(true);
    expect(isStandalone({}, () => ({ matches: false }))).toBe(false);
    expect(
      isStandalone({}, () => {
        throw new Error("no matchMedia");
      }),
    ).toBe(false);
  });
});

describe("chromeIntentUrl", () => {
  it("is built from host and path only (no query, no fragment)", () => {
    const url = chromeIntentUrl({ host: "app.example.in", pathname: "/patients" });
    expect(url).toBe("intent://app.example.in/patients#Intent;scheme=https;package=com.android.chrome;end");
    const withQuery = chromeIntentUrl({ host: "app.example.in", pathname: "/join", ...{ search: "?token=SECRET", hash: "#x" } } as never);
    expect(withQuery).not.toContain("SECRET");
    expect(withQuery).not.toContain("#x");
  });

  it("cannot be steered by odd host or path characters", () => {
    const url = chromeIntentUrl({ host: "app.example.in#Intent;package=evil;end", pathname: "/a#Intent;package=evil;end" });
    expect(url.match(/#Intent;/g)).toHaveLength(1);
    expect(url).toMatch(/;package=com\.android\.chrome;end$/);
    expect(url).not.toContain("package=evil");
  });
});

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  keys() {
    return [...this.map.keys()];
  }
}

describe("Today install card rules", () => {
  it("counts each browser session once; the marker is the preference name itself (no other key)", () => {
    const local = new MemoryStorage();
    const session1 = new MemoryStorage();
    expect(countSignedInSession(local as never, session1 as never)).toBe(1);
    expect(countSignedInSession(local as never, session1 as never)).toBe(1);
    const session2 = new MemoryStorage();
    expect(countSignedInSession(local as never, session2 as never)).toBe(2);
    expect(signedInSessionCount(local as never)).toBe(2);
    expect(local.keys()).toEqual([SESSION_COUNT_KEY]);
    expect(session2.keys()).toEqual([SESSION_COUNT_KEY]);
  });

  it("shows from the second session, while an install path exists, unless dismissed in the last 30 days", () => {
    const now = 1_800_000_000_000;
    expect(installCardVisible("ios-sheet", 1, null, now)).toBe(false);
    expect(installCardVisible("ios-sheet", 2, null, now)).toBe(true);
    expect(installCardVisible("prompt", 5, null, now)).toBe(true);
    expect(installCardVisible("none", 5, null, now)).toBe(false);
    expect(installCardVisible("prompt", 5, String(now + 1), now)).toBe(false);
    expect(installCardVisible("prompt", 5, String(now - 1), now)).toBe(true);
    expect(installCardVisible("prompt", 5, "garbage", now)).toBe(true);
  });

  it("dismissal writes the 30-day instant to the D-3 key", () => {
    const local = new MemoryStorage();
    dismissInstallCard(1000, local as never);
    expect(local.getItem(DISMISSED_UNTIL_KEY)).toBe(String(1000 + DISMISS_MS));
    expect(DISMISS_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
