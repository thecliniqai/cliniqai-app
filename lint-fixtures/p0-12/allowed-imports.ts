import type { MessagingProvider, InteractiveButton } from "@/lib/messaging";
import type { Msg91Provider } from "@/lib/messaging/providers/msg91";
import { PROVIDER_DISABLED } from "@/lib/messaging";
import { isSyntheticPhone } from "@/lib/messaging/synthetic-numbers";
import { enqueueMessage } from "@/lib/jobs/enqueue";

export type Fixture = [MessagingProvider, InteractiveButton, Msg91Provider];
export const fixture = [PROVIDER_DISABLED, isSyntheticPhone, enqueueMessage];
