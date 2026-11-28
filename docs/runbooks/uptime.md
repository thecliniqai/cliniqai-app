# Runbook: external uptime monitoring

V2-15 plan 15-03, decision D-6. Roadmap section 17.1 "external uptime monitors". Run by the PO on a free monitoring
account (UptimeRobot or Better Stack free tier), with MFA on that account.

## 1. Monitors

| Monitor | URL | Method | Interval | Expect | Alert after |
|---|---|---|---|---|---|
| Liveness | `https://<production-domain>/api/health` | GET | 5 min | HTTP 200 | 2 failures |
| Readiness | `https://<production-domain>/api/ready` | GET | 5 min | HTTP 200 and body contains `"ok"` | 2 failures |
| Login page | `https://<production-domain>/login` | GET | 5 min | HTTP 200 | 2 failures |

`/api/ready` is rate-limited (15-03); keep it to one monitor at 5 minutes. It reports provider state (email, billing key
mode, messaging) without secrets; a `degraded` body with HTTP 200 is not an outage but is reviewed the same day.

## 2. Alert channel

E-mail to the PO's daily mailbox (not the same account that hosts the app), plus the monitor's mobile push. Add a second
contact if the PO has one. Keyword monitors must not carry tokens in the URL; no basic-auth in URLs.

## 3. Status note

No public status page during UAT; the PO tells testers by WhatsApp or e-mail (templates in `docs/runbooks/uat.md`).

## 4. Verify

1. Pause the app's readiness (or point a throwaway monitor at a bad path) and confirm the alert arrives, then restore.
2. Leave monitors for 24 hours; the monitor's uptime shows 100 % or the outages are explained.

```
monitors created: health/ready/login yes/no
test alert received: yes/no, minutes
24 h uptime figure: <percent>
```

## 5. Limits to remember

Free monitors check from outside India; a regional problem may not be seen. The Free Supabase project may pause after
inactivity: the FT-03 heartbeat exists to prevent that (`docs/runbooks/alerts.md`).
