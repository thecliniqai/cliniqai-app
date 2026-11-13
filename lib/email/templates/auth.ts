/**
 * Code-only auth email templates (03-11b, AUTH-04a, 01-06 ruling R2). Each message carries the 6-digit code and no link
 * or URL. The HTML is the same text as `supabase/templates/*.html` (the SMTP fallback's templates) with the code in
 * place of `{{ .Token }}`; `tests/auth/send-email-hook.spec.ts` compares them, so the two cannot drift apart. The
 * invite copy has no Supabase template (the local stack sends no invites); the password-changed notice has no code.
 */
import type { EmailTag } from "../types";

export type AuthEmailKind = "signup" | "recovery" | "invite" | "email_change" | "password_changed";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  tag: EmailTag;
}

/** An auth code: digits only (the policy sets 6; up to 10 accepted so a policy change fails loudly elsewhere). */
export const AUTH_CODE_PATTERN = /^[0-9]{6,10}$/;

const CODE_STYLE = "font-size: 24px; font-weight: bold; letter-spacing: 4px;";

interface CodeTemplate {
  subject: string;
  tag: EmailTag;
  heading: string;
  intro: string;
  after: string[];
}

const CODE_TEMPLATES: Record<Exclude<AuthEmailKind, "password_changed">, CodeTemplate> = {
  // supabase/templates/confirmation.html
  signup: {
    subject: "Your ClinicOS confirmation code",
    tag: "auth-signup",
    heading: "Confirm your ClinicOS email address",
    intro: "Your confirmation code is:",
    after: [
      "Enter this code in ClinicOS to confirm this email address. It works once and expires soon.",
      "If you did not ask for a ClinicOS account, you can ignore this email.",
    ],
  },
  // supabase/templates/recovery.html
  recovery: {
    subject: "Your ClinicOS password reset code",
    tag: "auth-recovery",
    heading: "Reset your ClinicOS password",
    intro: "Your password reset code is:",
    after: [
      "Enter this code on the reset page. It works once and expires soon.",
      "If you did not ask to reset your password, you can ignore this email. Your password stays the same.",
    ],
  },
  // No Supabase template: GoTrue's invite email is only ever sent through this hook.
  invite: {
    subject: "Your ClinicOS invitation code",
    tag: "auth-invite",
    heading: "You have been invited to ClinicOS",
    intro: "Your invitation code is:",
    after: [
      "Enter this code in ClinicOS to accept the invitation. It works once and expires soon.",
      "If you were not expecting an invitation, you can ignore this email.",
    ],
  },
  // supabase/templates/email_change.html (sent to both the current and the new address, as GoTrue's mailer does)
  email_change: {
    subject: "Your ClinicOS email change code",
    tag: "auth-email-change",
    heading: "Confirm your new ClinicOS email address",
    intro: "Your email change code is:",
    after: [
      "Enter this code in ClinicOS to confirm the change. It works once and expires soon.",
      "If you did not ask to change your email address, do not enter the code, and tell your clinic administrator.",
    ],
  },
};

// supabase/templates/password_changed.html
const PASSWORD_CHANGED = {
  subject: "Your ClinicOS password was changed",
  heading: "Your ClinicOS password was changed",
  lines: [
    "The password for this ClinicOS account was just changed.",
    "If you made this change, you do not need to do anything.",
    "If you did not change it, reset your password from the ClinicOS sign-in page now, and tell your clinic administrator.",
  ],
};

export class InvalidAuthCodeError extends Error {
  readonly code = "invalid_auth_code";
  constructor() {
    super("The auth code is not a digit string");
    this.name = "InvalidAuthCodeError";
  }
}

/** Renders one auth email. `code` is required (digits only) for every kind except `password_changed`. */
export function renderAuthEmail(kind: AuthEmailKind, code?: string): RenderedEmail {
  if (kind === "password_changed") {
    const t = PASSWORD_CHANGED;
    return {
      subject: t.subject,
      tag: "auth-password-changed",
      html: [`<h2>${t.heading}</h2>`, ...t.lines.map((l) => `<p>${l}</p>`)].join("\n") + "\n",
      text: [t.heading, "", ...t.lines].join("\n") + "\n",
    };
  }
  // Digits only, so the code needs no escaping and can never carry markup or a link.
  if (code === undefined || !AUTH_CODE_PATTERN.test(code)) throw new InvalidAuthCodeError();
  const t = CODE_TEMPLATES[kind];
  return {
    subject: t.subject,
    tag: t.tag,
    html:
      [
        `<h2>${t.heading}</h2>`,
        `<p>${t.intro}</p>`,
        `<p style="${CODE_STYLE}">${code}</p>`,
        ...t.after.map((l) => `<p>${l}</p>`),
      ].join("\n") + "\n",
    text: [t.heading, "", t.intro, "", code, "", ...t.after].join("\n") + "\n",
  };
}
