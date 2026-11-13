// @ts-nocheck: an upper-case and a relative spelling that TypeScript would not resolve; only ESLint reads this file.
export async function f() {
  await import("@/lib/messaging");
  await import("@/lib/messaging/providers/msg91");
  await import("../../lib/messaging/index");
  await import("@/lib/webhooks/dispatcher");
  await import("@/LIB/webhooks/transport");
  require("@/lib/messaging/dev-logger");
  require("../webhooks/dispatcher");
  await import("@/lib/messaging/types");
  await import("@/lib/jobs/enqueue");
}
