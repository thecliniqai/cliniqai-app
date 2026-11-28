# Runbook: Supabase Free to Pro upgrade (FT-08)

V2-15 plan 15-04. Roadmap section 9.1 and 17.1 "Upgrade runbook (FT-08) written; the planned upgrade date and the
early-upgrade triggers on the PO's calendar". The planned upgrade is at UAT exit (PO-26) and **before the first
full-price charge**; Pro with PITR is a paid-launch (G7) criterion. The PO performs every step; agents never touch the
hosted project.

## 1. Triggers (upgrade early if any is true)

Take the numbers from section 9.1 of the roadmap; the working list during UAT:

1. Database size reaches 70 % of the Free limit, or Storage 70 %, or egress 70 % of the month.
2. Monthly active users approach the Free MAU limit.
3. The project was paused or throttled once for inactivity or quota (FT-03/FT-04 alert).
4. A restore or a data-loss event shows that a 12-hour RPO is not acceptable (any real clinic data lost).
5. UAT is extended beyond the planned exit date (this also triggers `docs/runbooks/uat-slip.md` check).
6. Realtime or connection limits are hit in `scripts/prod/realtime-sizing.mjs` output (15-03 code part).

Put two calendar entries today: the planned upgrade date (UAT exit minus 7 days) and a weekly Monday check of the
Supabase usage page.

## 2. Preparation (one week before)

1. Confirm a good FT-02 dump exists within the last 12 hours and the last monthly restore drill passed
   (`docs/runbooks/restore-drill.md`).
2. Billing: the Supabase organisation has a payment method and the PO has chosen compute **Small or larger**.
3. Announce a short maintenance window to testers only if the compute change restarts the database (Supabase states
   whether it does; plan for up to a few minutes of unavailability, outside clinic hours 08:00-20:00 IST).
4. Hosted-settings drift baseline: `node scripts/drift/*` as documented in `docs/runbooks/staging.md` (drift check
   against the checked-in expected settings) should be green before the change.

## 3. Upgrade steps

1. Supabase > Organization > Billing > change plan to **Pro**. Same organisation (production is already in its own).
2. Project > Settings > Compute and Disk: select Small or larger.
3. Project > Database > Backups: enable **Point in Time Recovery (7 days)**.
4. Authentication settings that Free did not offer: enable leaked-password protection; session time-box and inactivity
   timeout to the values in `scripts/ci/check-auth-config.mjs --print production`.
5. Logs: set retention or a drain per the then-current options (log drain is a V2-16 item, D-7).
6. Network restrictions and SSL enforcement: on if not already.
7. Spend cap: leave the cap on unless the PO chooses otherwise.

## 4. Verify

1. App: `/api/ready` green, one login, one check-in on the PO's test clinic.
2. Database: `select current_setting('server_version');` and the compute shown in the dashboard.
3. **PITR drill (G7 line):** note the time T, make one harmless change in the PO's test clinic (rename a test patient's
   note), wait 5 minutes, restore the project (or a clone) to T minus 2 minutes in the dashboard, verify the change is
   gone; record RPO (about 2 minutes) and RTO (time taken). Do this on a **clone** if the dashboard offers it, because a
   full restore overwrites production.
4. Hosted-settings drift check again; update the expected settings file in a PR if a setting changed on purpose.
5. FT-02 dumps keep running as the off-platform copy.

## 5. Rollback

A plan downgrade is possible at the next billing cycle; there is no data change in the upgrade itself. If the compute
change misbehaves, revert the compute size; do not disable PITR once enabled.

```
upgrade date: <date>   compute: <size>   PITR on: yes/no
PITR drill: RPO <min>, RTO <min>
drift check: green/red
```
