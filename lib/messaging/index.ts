import { serverEnv } from "@/lib/env-server";
import { DevLoggerProvider } from "./dev-logger";
import { DisabledMessagingProvider } from "./providers/disabled";
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
export * from "./providers/disabled";
export * from "./providers/msg91";
export * from "./providers/twilio";
export * from "./providers/gupshup";

let cachedProvider: MessagingProvider | null = null;
let cachedProviderName: string | null = null;

/**
 * The messaging provider named by `MESSAGING_PROVIDER` (or `overrideName`). V2-03 03-01 (P1-15): there is no fallback.
 * The env schema already refuses `msg91` without `MSG91_AUTH_KEY` (and the other providers without their
 * credentials), so a misconfigured provider fails when the environment is read instead of quietly becoming the dev
 * logger, which logs recipients and template parameters. An unknown name throws.
 */
export function getMessagingProvider(overrideName?: string): MessagingProvider {
  const providerName = (overrideName ?? serverEnv().MESSAGING_PROVIDER).toLowerCase();

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
    case "disabled":
      provider = new DisabledMessagingProvider();
      break;
    case "dev":
      provider = new DevLoggerProvider();
      break;
    default:
      throw new Error("Unknown messaging provider");
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
