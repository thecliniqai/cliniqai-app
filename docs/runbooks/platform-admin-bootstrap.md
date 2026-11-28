# Runbook: platform admin bootstrap and break-glass drill (production)

V2-15 plan 15-02, step 3. Roadmap section 17.1 "Platform admin bootstrapped with two TOTP factors; break-glass runbook
tested". Run by the PO. The break-glass procedure itself is written by V2-13c (`docs/runbooks/platform-admin-break-glass.md`,
13C-PLAN step 5); this runbook bootstraps the production identity and drills that procedure once. If the V2-13c file is
not merged when you run this, stop at section 4 and tell Claude.

Rules: a **dedicated** identity (never the e-mail used for any clinic account or personal login), a hardware or
authenticator-app second factor, two factors enrolled, no shared credentials, nothing in chat.

## 1. Create the identity

1. In the production app, sign up the admin e-mail address as an ordinary user using the normal signup path (it needs the
   production email path working, `docs/runbooks/email-production.md`), or create the Auth user in the Supabase
   dashboard (Authentication > Users > Add user) with a long random password from the password manager.
2. Note the user's UUID (an id, not the address): Authentication > Users.
3. Sign in once so the profile exists. Do **not** create a clinic for it.

## 2. Insert the admin row (SQL editor, production)

This is the only direct insert into `platform_admins`; everything afterwards goes through `platform.*` RPCs
(`docs/runbooks/subscriptions-sql.md`, "who may call"). The bootstrap SQL file `docs/runbooks/production-bootstrap.sql`
has this statement with a placeholder; run it there so there is one place.

```sql
insert into public.platform_admins (user_id, granted_by)
values ('<admin-user-uuid>', null);   -- columns per migration 000085

select user_id, revoked_at is null as active from public.platform_admins;   -- expected: exactly one active row
```

## 3. Two TOTP factors

1. Sign in as the admin; the platform portal forces MFA enrolment (AUTH_REDESIGN section 4.6: `aal2` is required for every
   platform action).
2. Enrol factor 1 on the main authenticator app; enrol factor 2 on a **different device or app** (so one lost phone does
   not lock the only admin). Store the recovery material in the password manager's secure notes, not in e-mail.
3. Sign out, sign in, confirm the session reaches `aal2` and the portal opens.

Verify (counts only):

```sql
select count(*) as verified_factors
from auth.mfa_factors
where user_id = '<admin-user-uuid>' and status = 'verified';   -- expected 2
```

## 4. Break-glass drill (once, on production)

Follow `docs/runbooks/platform-admin-break-glass.md` end to end, using a **second throwaway admin identity** so the real
one is never at risk: bootstrap it as above, then simulate losing both factors, run the dashboard-path recovery, write
the audit row by hand as the runbook says, enrol two new factors, and revoke the throwaway admin afterwards.

Verify:

```sql
select action, created_at from public.platform_audit_log order by created_at desc limit 10;
-- expected: the bootstrap, the break-glass entry written by hand, and the revoke of the throwaway admin
select count(*) as active_admins from public.platform_admins where revoked_at is null;   -- expected 1
```

## 5. Hygiene

- The admin e-mail is not used as a clinic user; no clinic data is opened with it except through the portal's audited
  actions.
- Revoke any Supabase dashboard member you do not recognise; MFA on every provider account (Supabase, Vercel, GitHub,
  Razorpay, Resend, AWS, DNS host).
- Add the admin factors to the quarterly access review (V2-16).

## Verify block (paste back)

```
active admin rows: 1
verified factors for the admin: 2
sign-in reaches aal2: yes/no
break-glass drill date and audit row ids: <date>, <ids>
throwaway admin revoked: yes/no
```
