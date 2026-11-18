/**
 * Deterministic interleaving for concurrency specs (V2-05 05-08), without sleeps or timers.
 *
 * A race between "check" and "write" only shows when every caller has finished its check before any caller writes.
 * Scheduling alone does not guarantee that, so a spec wraps each caller's database client with {@link gateClient}:
 * the named RPCs and the inserts into the named tables are held at a {@link Barrier} until `parties` callers have
 * reached it, then all are released together. Everything else on the client (reads, other RPCs such as `log_audit`)
 * passes straight through. With the barrier, the pre-fix code's lost update or double booking happens on every run,
 * and the fixed code must still produce the right outcome under the same interleaving.
 *
 * If a caller fails before reaching the barrier, the others wait until the test times out: a failing test, never a
 * false pass.
 */

export interface Barrier {
  /** Resolves (for every caller) once `parties` callers have called it. */
  wait(): Promise<void>;
  /** Callers that have arrived so far. */
  readonly arrived: number;
}

export function createBarrier(parties: number): Barrier {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    wait() {
      arrived += 1;
      if (arrived >= parties) release();
      return gate;
    },
    get arrived() {
      return arrived;
    },
  };
}

export interface Gates {
  /** RPC name → barrier the call waits at before it is sent. */
  rpc?: Record<string, Barrier>;
  /** Table name → barrier an `insert(...)` chain waits at before it is sent. */
  insert?: Record<string, Barrier>;
}

type Call = [PropertyKey, unknown[]];

/**
 * A stand-in for a PostgREST builder chain (`insert(row).select("id").single()`): it records the chained calls and,
 * when awaited, waits at the barrier, then replays the chain on a fresh real builder and awaits it.
 */
function deferredChain(start: () => unknown, barrier: Barrier, calls: Call[] = []): unknown {
  const run = async () => {
    await barrier.wait();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let builder: any = start();
    for (const [method, args] of calls) builder = builder[method](...args);
    return await builder;
  };
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const pending = run();
          return pending.then.bind(pending);
        }
        return (...args: unknown[]) => deferredChain(start, barrier, [...calls, [prop, args]]);
      },
    }
  );
}

function bindAll<T extends object>(target: T, prop: PropertyKey): unknown {
  const value = Reflect.get(target, prop);
  return typeof value === "function" ? value.bind(target) : value;
}

/** Wraps a Supabase client so the gated RPCs and inserts wait at their barriers (see the module comment). */
export function gateClient<T extends object>(db: T, gates: Gates): T {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "rpc") {
        return (name: string, ...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const call = () => (target as any).rpc(name, ...args);
          const barrier = gates.rpc?.[name];
          return barrier ? barrier.wait().then(call) : call();
        };
      }
      if (prop === "from") {
        return (table: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const builder = (target as any).from(table);
          const barrier = gates.insert?.[table];
          if (!barrier) return builder;
          return new Proxy(builder, {
            get(b, p) {
              if (p === "insert") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (...args: unknown[]) => deferredChain(() => (target as any).from(table).insert(...args), barrier);
              }
              return bindAll(b, p);
            },
          });
        };
      }
      return bindAll(target, prop);
    },
  });
}
