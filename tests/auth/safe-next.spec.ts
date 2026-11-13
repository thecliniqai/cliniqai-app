/**
 * `safeNextPath` (V2-03 03-12c; AUTH-04b safe `next`, threat T-03-04). The login page sends the user to
 * `safeNextPath(next) ?? "/"` after sign-in, so every refused value below lands on the default page.
 */
import { describe, expect, it } from "vitest";
import { MAX_NEXT_LENGTH, safeNextPath } from "@/lib/auth/safe-next";

describe("safeNextPath keeps same-origin paths", () => {
  it.each([
    ["/patients", "/patients"],
    ["/", "/"],
    ["/patients/123/edit", "/patients/123/edit"],
    ["/patients?tab=visits&page=2", "/patients?tab=visits&page=2"],
    ["/billing#unpaid", "/billing#unpaid"],
    ["/patients?q=Asha%20R", "/patients?q=Asha%20R"],
    // A path segment that looks like a scheme is still a path on this origin.
    ["/javascript:alert(1)", "/javascript:alert(1)"],
    // Dot segments resolve inside the origin.
    ["/patients/../billing", "/billing"],
  ])("%s → %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it(`accepts exactly ${MAX_NEXT_LENGTH} characters`, () => {
    const raw = `/${"a".repeat(MAX_NEXT_LENGTH - 1)}`;
    expect(safeNextPath(raw)).toBe(raw);
  });
});

describe("safeNextPath refuses everything else (the caller lands on its default page)", () => {
  it.each([
    // Off-origin: protocol-relative and backslash forms.
    ["protocol-relative", "//evil.example"],
    ["protocol-relative with path", "//evil.example/patients"],
    ["triple slash", "///evil.example"],
    ["slash-backslash", "/\\evil.example"],
    ["backslash-slash", "\\/evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["backslash later in the path", "/patients\\..\\..\\evil"],
    // Absolute and scheme URLs.
    ["https URL", "https://evil.example"],
    ["http URL", "http://evil.example/patients"],
    ["scheme-relative with userinfo", "//user@evil.example"],
    ["javascript: URL", "javascript:alert(1)"],
    ["JavaScript: mixed case", "JaVaScRiPt:alert(1)"],
    ["data: URL", "data:text/html,<script>alert(1)</script>"],
    ["vbscript: URL", "vbscript:msgbox(1)"],
    ["mailto: URL", "mailto:someone@example.com"],
    // Encoded slashes and backslashes (single, double, mixed case).
    ["encoded double slash", "/%2F%2Fevil.example"],
    ["encoded double slash lower case", "/%2f%2fevil.example"],
    ["encoded slash after the first", "/%2Fevil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["encoded backslash lower case", "/%5cevil.example"],
    ["double-encoded slash", "/%252F%252Fevil.example"],
    ["double-encoded backslash", "/%255Cevil.example"],
    ["fully encoded leading slashes", "%2F%2Fevil.example"],
    ["encoded scheme", "%6A%61%76%61%73%63%72%69%70%74:alert(1)"],
    // Control characters (raw and encoded); the URL parser drops tab/newline, turning `/\t/x` into `//x`.
    ["tab between slashes", "/\t/evil.example"],
    ["newline between slashes", "/\n/evil.example"],
    ["carriage return", "/patients\r\nSet-Cookie: x=1"],
    ["NUL", "/patients\u0000"],
    ["DEL", "/patients\u007f"],
    ["C1 control", "/patients\u0085"],
    ["encoded tab between slashes", "/%09/evil.example"],
    ["encoded newline", "/%0A/evil.example"],
    ["encoded NUL", "/patients%00"],
    // Malformed or never-settling encodings.
    ["malformed escape", "/patients%E0%A4%A"],
    ["lone percent", "/100%"],
    ["deep encoding", "/%25252525252F%25252525252Fevil.example"],
    // Shapes that are not a rooted path.
    ["empty", ""],
    ["relative path", "patients"],
    ["dot relative", "./patients"],
    ["dot-dot relative", "../patients"],
    ["leading space", " /patients"],
    ["question mark only", "?next=/patients"],
    ["hash only", "#/patients"],
    ["host only", "evil.example"],
    // Dot segments that collapse into a protocol-relative path.
    ["dot then double slash", "/.//evil.example"],
    ["dot-dot then double slash", "/..//evil.example"],
  ])("%s", (_name, raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it(`refuses more than ${MAX_NEXT_LENGTH} characters (600)`, () => {
    expect(safeNextPath(`/${"a".repeat(599)}`)).toBeNull();
    expect(safeNextPath(`/${"a".repeat(MAX_NEXT_LENGTH)}`)).toBeNull();
  });

  it.each([[null], [undefined], [42], [["/patients"]], [{ toString: () => "/patients" }]])("non-string %j", (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it("never returns a value the URL parser resolves off-origin", () => {
    // Property-style sweep: every accepted value must resolve to the placeholder origin.
    const samples = [
      "/patients",
      "//evil.example",
      "/\\evil.example",
      "/%2F%2Fevil.example",
      "/\t/evil.example",
      "/.//evil.example",
      "/..//evil.example",
      "/./%2Fevil.example",
    ];
    for (const raw of samples) {
      const out = safeNextPath(raw);
      if (out === null) continue;
      expect(new URL(out, "https://app.invalid").origin).toBe("https://app.invalid");
      expect(out.startsWith("//")).toBe(false);
    }
  });
});
