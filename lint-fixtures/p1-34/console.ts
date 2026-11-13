export function reportFailure(err: unknown) {
  console.error("payment failed", err);
  globalThis.console.warn("payment failed");
  const out = console;
  out.log("payment failed");
}
