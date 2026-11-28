# Runbook: production email (Resend through UAT, SES after go-live)

V2-15 plan 15-02, decision D-1 (PO, 2026-11-13: "Resend now, SES after go-live"). The provider seam is `lib/email`;
production sets `EMAIL_PROVIDER=resend`. The roadmap line that names SES with `auth.` DKIM/SPF/DMARC is satisfied for
UAT by the same domain checks on the Resend sending domain; SES (and its OIDC role, R-31) moves to V2-16.
Run by the PO. Record message ids and dates only, never keys, addresses or message bodies.

Related: `docs/runbooks/auth-email.md` (hook design and staging steps).

## 1. Sending domain

1. Resend > Domains > Add `auth.<production-domain>` (a sending subdomain keeps the root domain's reputation separate),
   region closest to India that Resend offers.
2. Add the DNS records Resend shows (SPF, DKIM, and the return-path record) at your DNS host. Add a DMARC record:
   `_dmarc.auth.<production-domain>  TXT  "v=DMARC1; p=none; rua=mailto:<security-or-ops-mailbox>"`. Start at
   `p=none`, move to `quarantine` after two clean weeks of UAT reports.
3. Resend > Verify. Wait until SPF, DKIM and the return path all show **verified**.
4. Check from your own machine (names only, no secrets):

```
dig +short TXT auth.<production-domain>
dig +short TXT _dmarc.auth.<production-domain>
```

## 2. Production API key

1. Resend > API Keys > create `clinicos-production`, permission **Sending access**, restricted to the domain above.
2. Store it only in the Vercel production environment as `RESEND_API_KEY` and in the password manager. Never reuse the
   staging key. `EMAIL_FROM` must be an address on the verified domain.
3. Production env also sets `EMAIL_PROVIDER=resend` (15-01 refuses the mail-catcher provider in production).

## 3. Supabase Send Email hook (production project)

1. Supabase production > Authentication > Hooks > **Send Email** > HTTPS hook to
   `https://<production-domain>/api/auth/send-email`; generate the hook secret and put it in the Vercel production
   environment under the same variable name staging uses (see `docs/runbooks/auth-email.md`) and in the password
   manager.
2. Auth settings come from the checked-in config: `node scripts/ci/check-auth-config.mjs --print production` prints
   what to set; confirm email OTP expiry, confirmation required and rate limits match.
3. Redeploy production.

## 4. Verify

1. Hook health: open `https://<production-domain>/api/ready` (rate-limited). It must list the email provider as
   `resend` and healthy, with no secret in the body.
2. Sign up a throwaway test clinic owner using an address you control. The signup code arrives in the inbox (not spam).
   Note the **Resend message id** from Resend > Emails (an id, not the address).
3. Open the message headers: SPF, DKIM and DMARC show `pass`.
4. Trigger a password-reset code once. Same checks.
5. `node scripts/prod/verify-email.mjs --message-id <id>` (15-02 code part, not yet in the repo, see 15-NOTES.md)
   will check the id shape and that the readiness endpoint reports the provider. Until then do steps 1 to 3 by hand.

## 5. Failure handling

| Symptom | Action |
|---|---|
| No code arrives | Resend > Emails: status. `bounced` or `suppressed` = address problem; no entry = hook not reached (Supabase hook logs, Vercel function logs) |
| Landed in spam | check DMARC alignment; keep the subject and body plain; do not change the sending domain during UAT |
| Resend outage | signup and reset are blocked; follow `docs/runbooks/incident.md` (severity 2); users can retry later, there is no email fallback provider during UAT |
| Key leaked | rotate (section 2), record in `docs/ops/secret-rotation.md` |

## 6. After go-live (V2-16, not now)

Switch to SES in `ap-south-1` behind the same seam, request production access (out of sandbox), add DKIM/SPF/DMARC on
`auth.`, replace static IAM keys with an OIDC role (R-31), keep Resend as the fallback for one release.

## Verify block (paste back)

```
SPF / DKIM / return path: verified (yes/no each)
DMARC record present: yes/no
readiness reports email provider resend: yes/no
signup code message id: <id>   reset code message id: <id>
header results SPF/DKIM/DMARC: pass/pass/pass
```
