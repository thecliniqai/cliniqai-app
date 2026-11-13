import { sendDirectWhatsApp } from "@/lib/messaging";

export const send = () => sendDirectWhatsApp("+919000000001", "t", {});
