/**
 * Input kinds (V2-06 06-02a step 4, PWA-07; PWA_STRATEGY §3.5): the kind → attributes table, and the guard that every
 * numeric-like kind brings a numeric keyboard and an Enter-key hint. Rendered through `<Input kind>` with
 * react-dom/server (no jsdom) to prove the primitive applies the table and that explicit props win.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { INPUT_KINDS, INPUT_KIND_ATTRIBUTES, NUMERIC_LIKE_KINDS, inputKindAttributes } from "@/lib/ui/input-kind";

const attrs = (html: string) =>
  Object.fromEntries([...html.matchAll(/\s([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
const inputOf = (props: Record<string, unknown>) => {
  const html = renderToStaticMarkup(createElement(Input, { "aria-label": "Synthetic field", ...props }));
  const tag = /<input\b[^>]*>/.exec(html)?.[0];
  if (!tag) throw new Error("no <input> rendered");
  return attrs(tag);
};

describe("INPUT_KIND_ATTRIBUTES (PWA §3.5)", () => {
  it("has exactly the plan's ten kinds", () => {
    expect([...INPUT_KINDS].sort()).toEqual(
      ["decimal", "email", "name", "numeric", "otp", "password-current", "password-new", "pincode", "search", "tel"],
    );
    expect(Object.keys(INPUT_KIND_ATTRIBUTES).sort()).toEqual([...INPUT_KINDS].sort());
  });

  it("maps each kind to the PWA §3.5 attributes", () => {
    expect(INPUT_KIND_ATTRIBUTES.tel).toMatchObject({ type: "tel", inputMode: "numeric", autoComplete: "tel-national", enterKeyHint: "next" });
    expect(INPUT_KIND_ATTRIBUTES.otp).toMatchObject({ inputMode: "numeric", autoComplete: "one-time-code" });
    expect(INPUT_KIND_ATTRIBUTES.email).toMatchObject({ type: "email", autoComplete: "email", autoCapitalize: "none" });
    expect(INPUT_KIND_ATTRIBUTES["password-current"]).toMatchObject({ type: "password", autoComplete: "current-password", enterKeyHint: "go" });
    expect(INPUT_KIND_ATTRIBUTES["password-new"]).toMatchObject({ type: "password", autoComplete: "new-password" });
    expect(INPUT_KIND_ATTRIBUTES.pincode).toMatchObject({ inputMode: "numeric", maxLength: 6, autoComplete: "postal-code" });
    expect(INPUT_KIND_ATTRIBUTES.numeric).toMatchObject({ type: "text", inputMode: "numeric" });
    expect(INPUT_KIND_ATTRIBUTES.decimal).toMatchObject({ type: "text", inputMode: "decimal" });
    expect(INPUT_KIND_ATTRIBUTES.search).toMatchObject({ type: "search", enterKeyHint: "search" });
    expect(INPUT_KIND_ATTRIBUTES.name).toMatchObject({ autoCapitalize: "words", autoComplete: "off" });
  });

  it("gives every numeric-like kind a numeric keyboard, an Enter hint and never type=number", () => {
    for (const kind of NUMERIC_LIKE_KINDS) {
      const a = INPUT_KIND_ATTRIBUTES[kind];
      expect(["numeric", "decimal"], kind).toContain(a.inputMode);
      expect(a.enterKeyHint, kind).toBeTruthy();
      expect(a.type, kind).not.toBe("number");
    }
  });

  it("answers no attributes without a kind", () => {
    expect(inputKindAttributes(undefined)).toEqual({});
  });
});

describe("<Input kind>", () => {
  it("renders the kind's attributes on the input element", () => {
    expect(inputOf({ kind: "tel" })).toMatchObject({
      type: "tel",
      inputmode: "numeric",
      autocomplete: "tel-national",
      enterkeyhint: "next",
      autocapitalize: "none",
    });
    expect(inputOf({ kind: "decimal" })).toMatchObject({ type: "text", inputmode: "decimal", enterkeyhint: "next" });
    expect(inputOf({ kind: "pincode" })).toMatchObject({ inputmode: "numeric", maxlength: "6" });
  });

  it("lets an explicit prop win over the kind", () => {
    expect(inputOf({ kind: "otp", maxLength: 8, enterKeyHint: "done" })).toMatchObject({
      inputmode: "numeric",
      maxlength: "8",
      enterkeyhint: "done",
    });
  });

  it("keeps a v1 input without a kind unchanged (no attributes added)", () => {
    const a = inputOf({ type: "email", inputMode: "email", autoComplete: "email" });
    expect(a).toMatchObject({ type: "email", inputmode: "email", autocomplete: "email" });
    expect(a.enterkeyhint).toBeUndefined();
  });
});
