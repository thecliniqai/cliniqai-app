import { postPinned } from "@/lib/webhooks/transport";
import { deliverWebhook as viaRelative } from "../../lib/webhooks/dispatcher";
import * as transport from "../../lib/webhooks/transport";
export { deliverWebhook } from "@/lib/webhooks/dispatcher";

export const fixture = [postPinned, viaRelative, transport];
