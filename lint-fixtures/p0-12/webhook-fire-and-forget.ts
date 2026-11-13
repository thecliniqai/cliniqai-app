import { deliverWebhook } from "@/lib/webhooks/dispatcher";

// The pre-04-03b shape: a request path starting a webhook POST and not waiting for it.
export const fire = (endpointUrl: string, signingSecret: string, rawBody: string) => {
  void deliverWebhook({ endpointUrl, signingSecret, rawBody }).catch(() => undefined);
};
