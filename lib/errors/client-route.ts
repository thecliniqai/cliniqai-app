/**
 * The route pattern of the page a client error boundary is showing (V2-06 06-04a step 2), from `usePathname()` and
 * `useParams()`: each path segment equal to a route parameter's value becomes `[name]` (`[...name]` for a catch-all),
 * so `/patients/<id>` is reported as `/patients/[id]`. The query string is never part of it (`usePathname` has none).
 * Isomorphic and pure. The server still refuses anything concrete that survives (lib/observability/client-render-event.ts).
 */
export type RouteParams = Record<string, string | string[] | undefined>;

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function routePatternOf(pathname: string | null | undefined, params: RouteParams | null | undefined): string {
  if (!pathname || !pathname.startsWith("/")) return "/";
  const byValue = new Map<string, string>();
  for (const [name, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) for (const item of value) byValue.set(item, `[...${name}]`);
    else if (typeof value === "string" && value !== "") byValue.set(value, `[${name}]`);
  }
  const out: string[] = [];
  for (const segment of pathname.slice(1).split("/")) {
    const token = byValue.get(segment) ?? byValue.get(decoded(segment)) ?? segment;
    // A catch-all spans several segments; its pattern is written once.
    if (token.startsWith("[...") && out[out.length - 1] === token) continue;
    out.push(token);
  }
  return `/${out.join("/")}`;
}
