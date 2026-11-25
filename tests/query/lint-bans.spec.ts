/**
 * V2-09e 09E-14a (E): the client data layer is memory only and per tab. Runs ESLint on a component that imports each banned TanStack package: a persister (browser
 * storage), the devtools, and the broadcast client (it would share one tab's cache with the others, across a clinic switch) are refused with the R-14 message.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const ROOT = path.resolve(__dirname, "../..");

describe("R-14 import bans", () => {
  const eslint = new ESLint({ cwd: ROOT, ignore: false, allowInlineConfig: false });
  it.each([
    "@tanstack/query-sync-storage-persister",
    "@tanstack/react-query-persist-client",
    "@tanstack/react-query-devtools",
    "@tanstack/query-broadcast-client-experimental",
  ])("%s is refused in app code", async (pkg) => {
    const [result] = await eslint.lintText(`import * as x from "${pkg}";\nexport const y = x;\n`, { filePath: path.join(ROOT, "components/shell/ban-probe.tsx") });
    expect(result.messages.filter((m) => m.message.includes("R-14:")).length).toBeGreaterThan(0);
  });
  it("the query package itself is allowed", async () => {
    const [result] = await eslint.lintText(`import { useQuery } from "@tanstack/react-query";\nexport const y = useQuery;\n`, { filePath: path.join(ROOT, "components/shell/ban-probe.tsx") });
    expect(result.messages.filter((m) => m.message.includes("R-14:"))).toEqual([]);
  });
});
