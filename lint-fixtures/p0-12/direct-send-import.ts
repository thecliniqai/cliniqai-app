// @ts-nocheck: sendDirect* were deleted in V2-04 04-03c; the names stay banned so they cannot come back (README).
import { sendDirectWhatsApp } from "@/lib/messaging";

export const send = () => sendDirectWhatsApp("+919000000001", "t", {});
