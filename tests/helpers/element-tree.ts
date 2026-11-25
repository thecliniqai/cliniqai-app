import { isValidElement, type ReactElement } from "react";

/**
 * The first element of `type` in a server component's returned element tree (depth first through `children`), or undefined. The dashboard layout wraps
 * the shell in providers (V2-09e 09E-13: the query provider, the hydration boundary, the bootstrap scope), so tests find the shell by its type, not its depth.
 */
export function findElement<P>(tree: unknown, type: unknown): ReactElement<P> | undefined {
  if (Array.isArray(tree)) {
    for (const t of tree) {
      const found = findElement<P>(t, type);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(tree)) return undefined;
  if (tree.type === type) return tree as ReactElement<P>;
  return findElement<P>((tree as ReactElement<{ children?: unknown }>).props.children, type);
}
