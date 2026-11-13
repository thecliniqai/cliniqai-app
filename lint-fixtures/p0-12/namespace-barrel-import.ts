// @ts-nocheck: sendDirect* were deleted in V2-04 04-03c; the names stay banned so they cannot come back (README).
import * as messaging from "@/lib/messaging";

export const send = () => messaging.sendDirectSms("+919000000001", "t", {});
