import * as messaging from "@/lib/messaging";

export const send = () => messaging.sendDirectSms("+919000000001", "t", {});
