# Runbook: incident response (production)

V2-15 plan 15-03 (P1-38). Roadmap section 17.1 "Incident runbook with the CERT-In 6-hour and DPDP breach templates".
Written for the PO and for any Claude session that is asked to help. Production holds real patient data once UAT clinics
enter it: **never paste PHI, secrets, phone numbers or e-mail addresses into chat, tickets, issues or templates.** Use
tenant ids, request ids and counts.

## 1. Roles

| Role | Who | Does |
|---|---|---|
| Incident commander (IC) | the PO | decides severity, containment, notifications; the only person who notifies authorities, clinics or patients |
| Technical lead | Claude (from the PO's description and ids) | triage, evidence from logs and counts, proposes fixes and wording; touches no hosted system itself |
| Scribe | the PO (Claude drafts) | keeps the timeline below with UTC and IST times |

There is no on-call rota during UAT; monitors e-mail the PO (`docs/runbooks/uptime.md`). Response targets during UAT:
acknowledge within 2 hours in the clinic day (08:00-20:00 IST), 12 hours otherwise.

## 2. Severity

| Sev | Meaning | Examples | First action |
|---|---|---|---|
| 1 | Confirmed or suspected exposure of patient data, loss of data, or the app unusable for every clinic | cross-tenant read, leaked service key, database deleted, backup bucket public | contain now (section 4), start the clock (section 5) |
| 2 | Core flow broken for some or all clinics, no data exposure | login, check-in, payment, email codes failing | status note to testers, fix or roll back |
| 3 | Degraded or cosmetic, workaround exists | slow screen, one reminder failing | normal ticket |

When unsure between 1 and 2, treat as 1 until data exposure is ruled out.

## 3. First 30 minutes

1. Write down the detection time and source (alert, tester message, monitor).
2. Open a private timeline (the PO's notes; template in section 7). Record every action with a time.
3. Check `https://<production-domain>/api/health` and `/api/ready` (provider and queue state, no secrets).
4. Look at the ops alerts and the in-app events (`ops.error_events`, backup and job tables; counts and codes only).
5. Decide severity and who is affected (tenant ids, not names).

## 4. Containment (pick the smallest that works; all are reversible)

| Need | Action |
|---|---|
| Bad release | Vercel > Deployments > previous good deployment > Promote (instant rollback). Migrations are forward-fixed; a destructive migration needs the latest dump (`docs/ops/backup-restore.md`) |
| Credential exposed | rotate it now (`docs/ops/secret-rotation.md`), redeploy; for the Supabase service key rotate the project API keys and redeploy |
| One tenant misbehaving or compromised | platform portal: suspend the tenant (audited), or revoke the user's sessions |
| Platform admin compromised | `docs/runbooks/platform-admin-break-glass.md` |
| Messaging abuse or wrong sends | pause the provider: set `MESSAGING_PROVIDER` to the disabled value in Vercel and redeploy; stop the reminder job (`docs/runbooks/jobs.md`) |
| Payments wrong | `docs/runbooks/razorpay-live.md` section 8; cancel affected provider subscriptions before the next debit |
| Everything on fire | Supabase dashboard > pause project is a last resort (it stops all clinics); prefer maintenance by rollback |

Preserve evidence: do not delete rows or logs; export counts and ids; keep Vercel and Supabase log screenshots (with
tokens and patient fields cropped).

## 5. Breach notification clock

If personal data of patients or staff may have been accessed, disclosed, altered or lost, **start two clocks at the moment
of awareness** (write the IST time down):

- **CERT-In: 6 hours** to report specified cyber security incidents (CERT-In Directions of 28 April 2022; includes
  unauthorised access to IT systems or data, data breach, data leak, attacks on servers or applications).
  Report to CERT-In by e-mail or its online form (details on cert-in.org.in; the PO confirms the current channel). A
  first report may be partial; add details as they are found. Also keep logs for 180 days in India (the in-app event
  retention covers this).
- **DPDP**: under the Digital Personal Data Protection Act 2023, a personal data breach must be reported to the Data
  Protection Board and to each affected Data Principal in the form and time the Rules prescribe. The PO confirms the
  current Rules text and timelines before sending; until then use the earliest of the draft windows below.
- **Clinics (data fiduciaries for their patients)**: tell each affected clinic owner promptly (target 24 hours, sooner
  for Sev 1), with what happened, what data, what we did and what they should do.

This runbook is an operational aid, not legal advice; the PO decides whether counsel is consulted (PO-12: no counsel
retained, so keep the templates factual and conservative).

## 6. Templates (fill placeholders; no PHI)

### 6.1 CERT-In initial report (within 6 hours)

```
To: <CERT-In incident reporting address, confirmed by the PO>
Subject: Cyber security incident report - <organisation name> - <date>

1. Reporter: <name>, <role>, <organisation>, <contact phone placeholder>, <contact e-mail placeholder>
2. Organisation and service: <clinicOS operator legal name>; clinic management software hosted on Supabase (Mumbai) and Vercel
3. Time of occurrence (IST): <...>   Time of detection (IST): <...>
4. Type of incident: <unauthorised access | data breach | data leak | malware | DDoS | other>
5. Affected systems and data categories: <systems; categories such as patient demographics, visit notes; NO patient values>
6. Number of affected clinics (tenants) and records: <counts or "under assessment">
7. Impact so far: <...>
8. Actions taken: <containment, rotation, rollback, with times>
9. Evidence preserved: <logs, dumps, screenshots, hashes>
10. Next update expected: <time>
```

### 6.2 DPDP breach notice to the Data Protection Board (draft; align to the current Rules)

```
Personal data breach intimation - <operator legal name> - <date>
- Nature, extent, timing and location of the breach: <...>
- Likely consequences for the affected Data Principals: <...>
- Measures taken and proposed to mitigate the risk: <...>
- Measures for the Data Principals to protect their interests: <...>
- Person who can be contacted: <name, role, contact placeholder>
- Detailed report to follow within the prescribed period: <date>
```

### 6.3 Notice to the affected clinic owner

```
Subject: Security incident affecting your clinicOS data

We detected on <date, IST> that <plain description>. It affected <data categories> for <n> records in your clinic.
It did <not> involve <payment details / passwords>. What we did: <containment, time>. What we recommend you do:
<change passwords, inform patients if needed, we will help with wording>. We will update you by <time>.
Contact: <support contact>.
```

### 6.4 Patient notice (sent by the clinic, drafted by us on request)

```
We are writing to tell you that, on <date>, some information held by <clinic name> in its clinic software may have been
seen by someone who should not have seen it. The information was <categories>. We have <actions>. You can <steps>.
Questions: <clinic contact>.
```

## 7. Timeline template and close-out

```
IST time | UTC time | Who | Event or action | Evidence ref (id, not content)
```

Close-out within 5 working days: root cause, what worked, what did not, fixes with owners and dates, whether the
register of sub-processors, the risk register or this runbook need changes, whether any notice was due and sent. Add a
VERIFICATION_LOG-style entry in `.planning/` with ids only.

## 8. Contacts (the PO fills; keep placeholders in git)

```
Security contact (published in security.txt): <set by the PO>
Support contact for clinics: <set by the PO>
CERT-In channel: <confirm on cert-in.org.in>
Supabase, Vercel, Razorpay, Resend, MSG91 support paths: <account-specific, in the password manager>
```
