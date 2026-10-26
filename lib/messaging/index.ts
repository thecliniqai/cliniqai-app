import { DevLoggerProvider } from "./dev-logger";
import { GupshupProvider } from "./providers/gupshup";
import { Msg91Provider } from "./providers/msg91";
import { TwilioProvider } from "./providers/twilio";
import {
  InteractiveButton,
  MessagingProvider,
  MessagingSendResult,
} from "./types";

export * from "./types";
export * from "./dev-logger";
export * from "./providers/msg91";
export * from "./providers/twilio";
export * from "./providers/gupshup";

let cachedProvider: MessagingProvider | null = null;
let cachedProviderName: string | null = null;

export function getMessagingProvider(overrideName?: string): MessagingProvider {
  const providerName = (
    overrideName ||
    process.env.MESSAGING_PROVIDER ||
    "dev"
  ).toLowerCase();

  if (cachedProvider && cachedProviderName === providerName) {
    return cachedProvider;
  }

  let provider: MessagingProvider;

  switch (providerName) {
    case "msg91":
      provider = new Msg91Provider();
      break;
    case "twilio":
      provider = new TwilioProvider();
      break;
    case "gupshup":
      provider = new GupshupProvider();
      break;
    case "dev":
    default:
      provider = new DevLoggerProvider();
      break;
  }

  cachedProvider = provider;
  cachedProviderName = providerName;
  return provider;
}

export async function sendDirectSms(
  to: string,
  templateId: string,
  params: Record<string, string>,
  providerName?: string
): Promise<MessagingSendResult> {
  const provider = getMessagingProvider(providerName);
  return provider.sendSms(to, templateId, params);
}

export async function sendDirectWhatsApp(
  to: string,
  templateId: string,
  params: Record<string, string>,
  buttons?: InteractiveButton[],
  providerName?: string
): Promise<MessagingSendResult> {
  const provider = getMessagingProvider(providerName);
  return provider.sendWhatsApp(to, templateId, params, buttons);
}
