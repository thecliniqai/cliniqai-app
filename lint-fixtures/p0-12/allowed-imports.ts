import type { MessagingProvider, InteractiveButton } from "@/lib/messaging";
import type { Msg91Provider } from "@/lib/messaging/providers/msg91";
import { PROVIDER_DISABLED } from "@/lib/messaging";
import { isSyntheticPhone } from "@/lib/messaging/synthetic-numbers";
import { enqueueMessage, enqueueWebhookEvent } from "@/lib/jobs/enqueue";
import type { DeliverWebhookInput } from "@/lib/webhooks/dispatcher";
import { validateWebhookEndpoint } from "@/lib/webhooks/ssrf";

export type Fixture = [MessagingProvider, InteractiveButton, Msg91Provider, DeliverWebhookInput];
export const fixture = [PROVIDER_DISABLED, isSyntheticPhone, enqueueMessage, enqueueWebhookEvent, validateWebhookEndpoint];
