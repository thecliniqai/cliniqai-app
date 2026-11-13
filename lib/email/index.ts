import "server-only";
import type { Env } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import { DisabledEmailSender } from "./disabled";
import { MailpitEmailSender } from "./mailpit";
import { ResendEmailSender } from "./resend";
import { SesEmailSender } from "./ses";
import { EmailConfigError, type EmailSender } from "./types";

export * from "./types";

/**
 * The configured {@link EmailSender} (03-11b). `EMAIL_PROVIDER` picks it: `resend` (staging/production until go-live,
 * 04-00b), `ses` (staging/production after go-live), `mailpit`
 * (local lanes, loopback), `disabled` (the default outside staging/production; sends nothing and throws
 * `EmailDisabledError`). The env schema has already checked every value the chosen sender needs; a sender still
 * refuses a configuration it cannot run with (`EmailConfigError`).
 */
export function getEmailSender(env: Env = serverEnv()): EmailSender {
  switch (env.EMAIL_PROVIDER) {
    case "ses":
      if (!env.EMAIL_FROM || !env.SES_ACCESS_KEY_ID || !env.SES_SECRET_ACCESS_KEY) {
        throw new EmailConfigError("ses_config", "SES needs EMAIL_FROM, SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY");
      }
      return new SesEmailSender({
        from: env.EMAIL_FROM,
        credentials: { accessKeyId: env.SES_ACCESS_KEY_ID, secretAccessKey: env.SES_SECRET_ACCESS_KEY },
      });
    case "resend":
      if (!env.EMAIL_FROM || !env.RESEND_API_KEY) {
        throw new EmailConfigError("resend_config", "Resend needs EMAIL_FROM and RESEND_API_KEY");
      }
      return new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
    case "mailpit":
      return new MailpitEmailSender({ apiUrl: env.MAILPIT_API_URL ?? "", from: env.EMAIL_FROM ?? "", appEnv: env.APP_ENV });
    case "disabled":
      return new DisabledEmailSender();
  }
}
