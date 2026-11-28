/**
 * V2-10 10-01 (D-1; DESIGN_SYSTEM §5, §7.7): `lib/money`, the one money vocabulary. Integer paise in the app, rupees as
 * `NUMERIC(10,2)` at the service boundary: the round trip is exact for every 2-decimal value from ₹0.00 to ₹10,000.00,
 * the display is en-IN with paise only when non-zero and a true minus, and typed text that is not a plain amount is
 * refused. Pure functions; no database.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_MONEY_PAISE,
  MINUS,
  formatINR,
  formatINRAscii,
  formatINRPlain,
  fromPaise,
  groupIndian,
  parseINR,
  roundRupees,
  toPaise,
} from "@/lib/money";
import { moneyInputValue } from "@/components/ui/money-input";

describe("paise round trip", () => {
  it("is exact for every 2-decimal value from 0.00 to 10,000.00 (1,000,001 values)", () => {
    const misses: string[] = [];
    for (let paise = 0; paise <= 1_000_000; paise++) {
      const rupees = paise / 100; // the number a numeric(10,2) column arrives as
      const text = rupees.toFixed(2); // and as numeric text
      if (
        toPaise(rupees) !== paise ||
        toPaise(text) !== paise ||
        fromPaise(paise) !== rupees ||
        roundRupees(rupees) !== rupees ||
        parseINR(formatINRPlain(paise)) !== paise ||
        parseINR(formatINR(paise)) !== paise
      ) {
        misses.push(text);
        if (misses.length > 5) break;
      }
    }
    expect(misses).toEqual([]);
  });

  it("removes float noise and rounds a third decimal half away from zero", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(0.29)).toBe(29); // 0.29 * 100 = 28.999999999999996
    expect(toPaise(1.005)).toBe(101);
    expect(toPaise("1.005")).toBe(101);
    expect(toPaise("1.004")).toBe(100);
    expect(toPaise(-12.34)).toBe(-1234);
    expect(toPaise("-12.34")).toBe(-1234);
    expect(toPaise(99_999_999.99)).toBe(9_999_999_999); // the numeric(10,2) maximum
    expect(Object.is(toPaise(-0.001), 0)).toBe(true);
  });

  it("refuses what is not an amount", () => {
    expect(() => toPaise(Number.NaN)).toThrow(RangeError);
    expect(() => toPaise(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toPaise("12abc")).toThrow(RangeError);
    expect(() => toPaise("1e3")).toThrow(RangeError);
    expect(() => fromPaise(1.5)).toThrow(RangeError);
  });
});

describe("formatINR", () => {
  it.each([
    [12_500_000, "₹1,25,000"],
    [49_950, "₹499.50"],
    [-5_000, `${MINUS}₹50`],
    [0, "₹0"],
    [5, "₹0.05"],
    [65_000, "₹650"],
    [100_000, "₹1,000"],
    [1_234_567_890, "₹1,23,45,678.90"],
    [MAX_MONEY_PAISE, "₹10,00,00,000"],
    [-20_000, "−₹200"],
  ])("%i paise → %s", (paise, text) => {
    expect(formatINR(paise)).toBe(text);
  });

  it("uses U+2212 for a negative amount, never a hyphen", () => {
    expect(formatINR(-5_000).codePointAt(0)).toBe(0x2212);
    expect(formatINR(-5_000)).not.toContain("-");
  });

  it("refuses a non-integer paise amount", () => {
    expect(() => formatINR(12.5)).toThrow(RangeError);
    expect(() => formatINR(Number.NaN)).toThrow(RangeError);
  });

  it("formatINRAscii is the same amount for the standard PDF fonts (no ₹ or U+2212 glyph)", () => {
    expect(formatINRAscii(12_500_000)).toBe("Rs. 1,25,000");
    expect(formatINRAscii(49_950)).toBe("Rs. 499.50");
    expect(formatINRAscii(-5_000)).toBe("-Rs. 50");
    expect([...formatINRAscii(-123_456_789)].every((c) => c.charCodeAt(0) < 0x80)).toBe(true);
  });

  it("formatINRPlain is the field text without the symbol, and refuses a negative", () => {
    expect(formatINRPlain(12_500_000)).toBe("1,25,000");
    expect(formatINRPlain(49_950)).toBe("499.50");
    expect(() => formatINRPlain(-1)).toThrow(RangeError);
  });

  it("groups the Indian way: the last three digits, then pairs", () => {
    expect(["0", "999", "1000", "99999", "100000", "1234567", "123456789"].map((d) => groupIndian(Number(d)))).toEqual([
      "0",
      "999",
      "1,000",
      "99,999",
      "1,00,000",
      "12,34,567",
      "12,34,56,789",
    ]);
  });
});

describe("parseINR", () => {
  it.each([
    ["1,25,000", 12_500_000],
    ["125,000", 12_500_000],
    ["125000", 12_500_000],
    ["₹499.5", 49_950],
    ["₹ 499.50", 49_950],
    [" 500 ", 50_000],
    ["500.", 50_000],
    [".5", 50],
    ["0", 0],
    ["10,00,00,000", MAX_MONEY_PAISE],
  ])("%j → %i paise", (text, paise) => {
    expect(parseINR(text)).toBe(paise);
  });

  it.each(["1e3", "1.234", "-5", "−5", "-₹5", "abc", "", " ", ".", "1,2,3", "12,34,5", "1,00", "5.5.5", "0x10", "Infinity", "10,00,00,000.01"])(
    "refuses %j",
    (text) => {
      expect(parseINR(text)).toBeNull();
    },
  );
});

describe("MoneyInput value", () => {
  it("emits integer paise for typed text, null for text that is not an amount or is above the maximum", () => {
    expect(moneyInputValue("1,25,000")).toBe(12_500_000);
    expect(moneyInputValue("650")).toBe(65_000);
    expect(moneyInputValue("499.5")).toBe(49_950);
    expect(moneyInputValue("")).toBeNull();
    expect(moneyInputValue("1.234")).toBeNull();
    expect(moneyInputValue("1,000.01", 100_000)).toBeNull();
    expect(moneyInputValue("1,000", 100_000)).toBe(100_000);
  });
});
