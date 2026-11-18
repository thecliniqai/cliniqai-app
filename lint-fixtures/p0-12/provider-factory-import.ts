import { getMessagingProvider } from "@/lib/messaging";

export const send = () => getMessagingProvider().sendSms("+919000000001", "t", {});
