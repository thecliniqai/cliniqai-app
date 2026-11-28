# UAT campaign guide (for the PO)

V2-15 plan 15-06. How the UAT stage runs day to day. Mechanics (codes, comp fallback, exit checklist) are in
`docs/runbooks/uat.md`; slips in `docs/runbooks/uat-slip.md`. Never write clinic names, people, phone numbers, e-mail
addresses or codes into repository files.

## 1. Recruit (PO-13 scale)

Target: 5 clinics with about 3 users each (owner, one doctor, one receptionist; a nurse where the clinic has one). Pick
clinics that will use it on real days, and tell each owner plainly: this is a trial, data they enter is real and is
protected by the Privacy page, and the first month is free for UAT.

Keep your own private sheet (not in the repo): clinic label, owner, channel, invite date, signed up date, device types.

## 2. Timeline

| When | What |
|---|---|
| T-14 days before start | recruit, confirm devices, MSG91 templates approved |
| T-3 | `uat-campaign.sql` run, codes exported, invites drafted |
| T0 (UAT start, after G6) | send invites one by one; day 1 call or voice note per clinic |
| Week 1 | daily check of alerts and feedback; fix blockers within a day |
| Weeks 2 to exit | weekly check-in with each owner; weekly metrics |
| Exit minus 14 days | decide the upgrade, check `free_until` against G7 readiness (slip decision at T-10) |
| Exit | UAT exit checklist (`uat.md` section 7) |

## 3. Feedback channel

One channel only (a WhatsApp number or an e-mail address set by the PO in the in-app Help page, placeholder here:
`<feedback channel>`). Triage twice a day in week 1, daily after. Each item gets a severity:

| Severity | Meaning | Target |
|---|---|---|
| S1 | data wrong or lost, cannot work at all | same day, incident process |
| S2 | a core flow fails or confuses most users | 2 working days |
| S3 | annoyance, wording, small layout | batched, weekly |

Log items in the PO's tracker with the clinic label, the screen, the time and a screenshot with patient details hidden.

## 4. Success metrics (read weekly, from the ops report and the PO's notes)

- Interaction counts: check-ins, consults, prescriptions per clinic per week.
- Error rate: error events per 1,000 requests (ops report), and any S1 or S2 open.
- Message delivery: reminder delivery rate.
- UAT-to-paid intent: one question at exit to each owner ("would you pay Rs 1,499 plus GST per month?" yes, maybe, no,
  and why).

## 5. Message templates (fill placeholders)

**Welcome after signup**
> Hello <owner first name>, welcome to the clinicOS trial. Your first steps are in the tester guide: <link>. Tell us
> anything that confuses you at <feedback channel>. We read every message.

**Exit date moved (slip)**
> Hello <owner first name>, the trial date moved to <new date>. Nothing is charged before then, and nothing is charged
> now. When we launch, we will ask you to confirm AutoPay again. Questions: <support contact>.

**Refund notice (debited in error)**
> Hello <owner first name>, a charge of Rs <amount> was taken by mistake on <date>. We have refunded it in full; it can
> take up to <provider's stated days> to show. We are sorry. Reference: <refund id>. Questions: <support contact>.

**Downtime**
> clinicOS is having a problem since <time>. Your data is safe. We are working on it and will message again by <time>.

## 6. Escalation

Anything involving patient data exposure: `docs/runbooks/incident.md` immediately. Payment mistakes: `razorpay-live.md`
section 8. Keep a log of every message you send to testers (date and template name only).
