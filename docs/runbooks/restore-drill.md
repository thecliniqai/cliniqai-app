# Runbook: restore drill (G6, FT-02, P0-16b)

V2-15 plan 15-04, decision CTO-1. Roadmap section 17.1 "Restore drill passed within the last 30 days ... with the pgTAP
RLS suite green, RPO (12 h or less) and RTO recorded". This file is the G6 drill. The monthly drills after the first
real clinic enters patient data use `docs/runbooks/restore-drill-aws.md`, never a laptop.

Related: `docs/runbooks/backup-restore.md` (the pieces and pins), `ops/restore-drill/run.sh`.

## 1. Why the G6 drill runs on the bootstrap dump

Once UAT clinics enter real patient data, a production dump on a workstation puts PHI on a laptop (04-PLAN R-42). So the
G6 drill runs on **the production dump taken right after the production bootstrap**: it contains only the platform
admin, plans, reference data and synthetic smoke data (one smoke clinic made by the PO, no real person). It proves the
whole path (dump, encrypt, upload, download, decrypt, restore, RLS suite) without PHI. Take it **before any UAT clinic
signs up**, and within 30 days of G6.

Rule for the drill machine: the PO's own workstation, full-disk encryption on, the plaintext deleted at the end, never
a shared or cloud-synced folder.

## 2. Take the dump (production)

1. Run the production backup workflow on demand (the workflow dispatch for production; see `docs/ops/backup-restore.md`
   production section). Wait for success; note the run id and the archive's **SHA-256** from the job summary.
2. Confirm the `ops.backup_runs` row is `ok` (counts only). Two consecutive scheduled dumps must also exist before G6.

## 3. Restore locally (PO machine)

1. Download the archive from the production bucket with a read-only role (not the write-only task role).
2. Local stack rules: `npm run stack:recycle` first. Then
   `ops/restore-drill/run.sh <archive> --expect-sha256 <digest from the green run> --age-identity <primary identity file>`
   (the exact flags are in the script header). It decrypts, SQL-guards the files, restores into the second stack
   `clinicos-drill`, verifies row counts against `manifest.json`, writes the evidence JSON and stops the stack.
3. Run the pgTAP RLS suite on the restored database: the tool prints the command and port at the end of its output
   (`npm run test:pgtap` style, pointed at the drill stack).
4. Delete the plaintext, the decrypted tar and the identity file copy. Keep only the evidence JSON.

## 4. Record

The evidence JSON has the RPO (age of the newest data in the dump versus the dump time, must be 12 h or less) and RTO
(download to verified, with the time to download and decrypt included). Paste into
`.planning/phases/15-production-readiness-uat-launch/15-VERIFICATION.md` (by the tool's output, not retyped).

```
dump run id / archive sha256: <id> / <digest>
checksum matched: yes/no
row counts match manifest: yes/no
pgTAP RLS suite: pass/fail, <n> tests
RPO (h) / RTO (min): <n> / <n>
plaintext deleted: yes/no
```

## 5. Failure handling

A failure is a defect, not a retry: keep the evidence JSON, open an incident (Sev 2), fix, take a new dump, repeat. If
the checksum mismatches, do not decrypt; treat as possible tampering (Sev 1 per `incident.md`).

## 6. Local rehearsal (Claude)

`node scripts/ops/restore-drill.mjs --local` (15-04 code part) dumps the local synthetic stack, restores into a second
local stack and runs the pgTAP suite; the nightly lane runs it. It is not a substitute for section 3.
