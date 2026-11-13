import { EmailDisabledError, type EmailMessage, type EmailSender, type SendResult } from "./types";

/**
 * `EMAIL_PROVIDER=disabled` (03-11b, R-16, R-17): sends nothing and says so. The hook route turns the error into a
 * 503 so Supabase Auth reports a failed send instead of a delivered one.
 */
export class DisabledEmailSender implements EmailSender {
  readonly provider = "disabled" as const;

  async send(message: EmailMessage): Promise<SendResult> {
    void message;
    throw new EmailDisabledError();
  }
}
