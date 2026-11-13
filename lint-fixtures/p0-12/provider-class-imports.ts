import { Msg91Provider } from "@/lib/messaging/providers/msg91";
import { SinkProvider } from "../../lib/messaging/providers/sink";
import { DevLoggerProvider } from "@/lib/messaging/dev-logger";
import { DisabledMessagingProvider, TwilioProvider } from "@/lib/messaging/index";

export const providers = [Msg91Provider, SinkProvider, DevLoggerProvider, DisabledMessagingProvider, TwilioProvider];
