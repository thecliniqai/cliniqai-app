# Runbook: auth email (SES + Supabase Send Email hook)

V2-03 plan 03-11b (AUTH-03, A00-1, PO-A3). Rulings R-10, R-16, R-17, R-20, R-31. The PO does every hosted step in this
runbook (PO actions E0, E4, E5, E6, E8). Agents never change AWS, DNS, Vercel or Supabase settings and never send real
email.

## How it works

1. Supabase Auth (GoTrue) needs to send an auth email (password reset, invite, email change, signup confirmation, or
   the "password changed" security notice).
2. With the Send Email hook on, GoTrue sends nothing itself. It `POST`s the event to
   `https://staging.<domain>/api/auth/send-email`, signed with Standard Webhooks headers (`webhook-id`,
   `webhook-timestamp`, `webhook-signature`) and the hook secret.
3. The route (`app/api/auth/send-email/route.ts`):
   - refuses a body over 64 KiB (413);
   - refuses any call whose signature does not verify with `SEND_EMAIL_HOOK_SECRET`, or whose timestamp is more than
     5 minutes away from now (401);
   - zod-parses the payload (400 if malformed).
4. It then acts on `email_action_type`:

   | Action | What the route does |
   |---|---|
   | `magiclink` | **Dropped**: 200, nothing sent (A00-1, closes the mailbox password bypass) |
   | `signup`, `recovery`, `invite` | One code email to `user.email` |
   | `email_change` | `token` to the current address and `token_new` to `user.new_email` (secure email change is on everywhere). Any other shape → 400 |
   | `password_changed_notification` | The code-free security notice to `user.email` |
   | anything else (`reauthentication`, other notifications) | Dropped: 200, nothing sent, logged |

5. Templates are code only: a 6-digit code, no link (`lib/email/templates/auth.ts`). They are the same text as
   `supabase/templates/*.html`, and a spec keeps the two equal.
6. The message goes out through the `EmailSender` that `EMAIL_PROVIDER` selects (`lib/email`). The route answers 200
   only after the provider accepts every message. If the provider fails it answers 500; if `EMAIL_PROVIDER=disabled`
   it answers 503. Both use the hook error shape `{ "error": { "http_code", "message" } }`, so Auth reports the failure
   to the user instead of claiming the email was sent.
7. Logs: `auth.email.sent` / `auth.email.dropped` / `auth.email.refused` / `auth.email.failed`. Each line carries the
   action type, the provider (`module`), a count or reason, and the request id. **Never** an address, a code, a token
   hash or a provider message.

## Environment (names exactly as the env schema reads them)

| Name | Staging | Production | Notes |
|---|---|---|---|
| `EMAIL_PROVIDER` | `disabled` until E6/E8, then `ses` | `ses` (required) | `mailpit` is refused in both |
| `EMAIL_FROM` | `no-reply@auth.<domain>` | same pattern | Required for `ses` |
| `SES_ACCESS_KEY_ID` | key id of IAM user `clinicos-staging-ses` | production IAM user | Required for `ses`. Shape `AKIA` + 16 characters |
| `SES_SECRET_ACCESS_KEY` | its secret (Sensitive) | same | Required for `ses`, at least 40 characters |
| `SEND_EMAIL_HOOK_SECRET` | from E8, as shown: `v1,whsec_…` | required | Decoded key at least 24 bytes. Unset → every call 401 |

- **Do not set** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or `AWS_REGION` in Vercel. Vercel reserves these names:
  it rejects them, and its functions already carry their own platform values under them. The app never reads them.
  The SES client gets its credentials explicitly from `SES_*`, and its region is the constant `ap-south-1`
  (`SES_REGION` in `lib/env.ts`, PO-A3).
- `/api/ready` reports `providers.email`: `configured` only for `ses`.

## One-time setup (PO)

### E6: Amazon SES in ap-south-1 (Mumbai)

1. SES → Identities → Create identity → **Domain** `auth.<domain>`.
   - Easy DKIM, RSA 2048.
   - Custom MAIL FROM domain `mail.auth.<domain>`, behaviour on MX failure "Use default MAIL FROM domain".
2. Account dashboard → **Request production access**: transactional, low volume, "authentication codes for clinic
   staff". While the account is in the sandbox, verify your own test recipient (Identities → Create identity → Email
   address). Acceptance 9 can pass in the sandbox with that recipient (assumption A6).
3. Account-level **suppression list**: on, for bounces and complaints (R-10). The SNS → bounce webhook arrives with
   the V2-04 outbox.
4. IAM → Users → `clinicos-staging-ses`, no console access, with this inline policy and nothing else:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "ses:SendEmail",
         "Resource": "arn:aws:ses:ap-south-1:<account-id>:identity/auth.<domain>",
         "Condition": { "StringEquals": { "ses:FromAddress": "no-reply@auth.<domain>" } }
       }
     ]
   }
   ```

   Create one access key. Put it only in Vercel as `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` (Sensitive). Keep no
   other copy. An OIDC role replaces the key in V2-15 (R-31).
5. Verify (read-only), and paste the output to Claude:
   `aws sesv2 get-email-identity --email-identity auth.<domain> --region ap-south-1 --query "{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}"`
   and `aws sesv2 get-account --region ap-south-1 --query ProductionAccessEnabled`.

### E5: DNS for `auth.<domain>`

| Record | Name | Value |
|---|---|---|
| CNAME ×3 | `<token>._domainkey.auth.<domain>` | the three Easy DKIM values from E6 |
| MX | `mail.auth.<domain>` | `10 feedback-smtp.ap-south-1.amazonses.com` |
| TXT | `mail.auth.<domain>` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc.auth.<domain>` | `v=DMARC1; p=none; rua=mailto:<your inbox>`; tighten to `p=quarantine` after a clean week |

Claude checks them with `dig +short` (CNAME, MX, TXT).

### E8: the hook on staging

1. Supabase staging → Authentication → Hooks → **Send Email** → HTTPS → URL
   `https://staging.<domain>/api/auth/send-email` → **Generate secret**.
2. Vercel (`clinicos-staging`): set `SEND_EMAIL_HOOK_SECRET` to the secret exactly as shown (`v1,whsec_…`), set
   `EMAIL_PROVIDER=ses`, and redeploy.
3. Request a password reset on staging for your SES-verified address.
4. Verify:
   - the `drift.yml` `auth-config` job shows the hook enabled with that URI (03-11a);
   - paste the received mail's `Authentication-Results` line. Expect `dkim=pass header.d=auth.<domain>`. The mail
     holds only a code;
   - the function log shows one `auth.email.sent` line with `action: "recovery"` and a request id.

Deployment Protection must be off for the staging production domain, or the hook gets Vercel's 401 (assumption A2,
risk K-6).

## SMTP fallback (configured-ready, not active)

If the hook route cannot be used:

1. SES → SMTP settings → Create SMTP credentials. This creates a separate IAM user with `ses:SendRawEmail`; limit it
   to the same identity ARN and `ses:FromAddress` condition.
2. Supabase → Authentication → Emails → SMTP Settings → host `email-smtp.ap-south-1.amazonaws.com`, port `587`
   (STARTTLS), the SMTP user name and password, sender `no-reply@auth.<domain>`.
3. Paste the four bodies from `supabase/templates/` into the dashboard templates (recovery, confirmation,
   email change, password changed). They are code only. GoTrue's built-in mailer does **not** drop `magiclink`, so
   while SMTP is the path, A00-1 depends on signups staying off. `/otp` for an existing user would then mail a working
   sign-in code. Restore the hook as soon as possible.

## Rollback

- **Hook misbehaving.** Supabase → Hooks → Send Email → disable. GoTrue falls back to its own mailer: the SMTP
  fallback if it is configured, otherwise Supabase's default rate-limited mailer. Same `magiclink` caveat as above.
- **SES failing** (sandbox, suppression, quota). Set `EMAIL_PROVIDER=disabled` and redeploy. Every auth email then
  fails with 503 and Auth shows an error. Nothing is half-sent. Then fix SES or switch to the SMTP fallback.
- **Code rollback.** Revert the 03-11b commits. With the hook still enabled, every auth email fails until the hook is
  disabled, so disable the hook first.

## Rotating the hook secret

The app verifies against one secret; GoTrue signs with every secret configured on the hook, and the route accepts any
one valid signature in the header. If the dashboard lets you keep two secrets, use this order:

1. Add the new secret on the hook.
2. Set `SEND_EMAIL_HOOK_SECRET` to the new value and redeploy.
3. Remove the old secret from the hook.

If the dashboard only replaces the secret, accept a window of a few seconds: change Vercel and redeploy, then
regenerate. During the window, resets fail visibly; nothing is sent to the wrong place.

## Local and CI

- Local GoTrue keeps the hook **off** (`config.toml`, policy row in `supabase/auth-policy.json`) and sends to
  Mailpit over SMTP. On Linux CI its container cannot reach a loopback app server.
- Vitest: `EMAIL_PROVIDER` unset (= `disabled`). Specs stub `mailpit` or inject a fake sender. The SES sender is
  tested only with an injected client or a capturing HTTP handler. The test-env guard forbids `AWS_*` and `SES_*`
  credentials and pins `SEND_EMAIL_HOOK_SECRET` to the local synthetic secret.
- The e2e server runs `EMAIL_PROVIDER=mailpit` (`http://127.0.0.1:54324`) with the local synthetic secret.
  `tests/e2e/auth/send-email-hook.spec.ts` signs payloads with it.
- Payload fixtures: `lint-fixtures/auth-hook/`. Real GoTrue shapes:
  `.planning/phases/03-platform-hygiene/evidence/03-11b/gotrue-hook-shapes.jsonl`.
