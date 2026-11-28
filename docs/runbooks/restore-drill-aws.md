# Runbook: monthly restore drill on an ephemeral AWS host

V2-15 plan 15-04, decision CTO-1 (later drills). From the first real clinic's data on, **no production dump touches a
laptop**. The drill restores into a temporary, encrypted EC2 Docker host in AWS `ap-south-1`, inside the backup account,
and destroys it afterwards. No RDS (cost and persistence). Monthly during UAT (V2-16); also before the paid launch.

First drill: `docs/runbooks/restore-drill.md` (G6, on the bootstrap dump). This runbook is written now and exercised in
V2-16; the commands are the CLI forms, so they can be checked by reading.

## 1. Design

| Item | Choice |
|---|---|
| Account and region | the backup AWS account, `ap-south-1`; MFA on every human identity |
| Host | one `t3.medium` (or similar) EC2 instance, Amazon Linux or Ubuntu LTS, **EBS encrypted with a KMS key**, no public IP, reachable only through SSM Session Manager (no SSH key, no inbound rules) |
| Network | a private subnet with outbound via a NAT or VPC endpoints for S3 and SSM; security group with **no inbound** |
| Role | an instance profile with read-only access to the backup bucket prefix and decrypt rights for nothing else; the age **identity file** is not on the host until step 3 and is deleted at the end |
| Software | Docker, the pinned images from `ops/bin/pins.env` (`postgres`, `aws-cli`), the repo at the release tag for `ops/restore-drill/run.sh` |
| Lifetime | created at the start of the drill, **terminated at the end** (the EBS volume is deleted on termination) |

## 2. Prepare (once)

The CloudFormation or shell template is in `ops/backup/production/` (15-04 code part; not yet in the repo, see
15-NOTES.md). Until then create the host by hand from the table above and write the instance id in the drill record.

## 3. Drill steps

1. Launch the instance (encrypted EBS, instance profile, no inbound). Tag it `purpose=restore-drill`, `expires=<date +1 day>`.
2. Connect with SSM Session Manager. Install Docker if the AMI lacks it; clone the repo at the release tag; no
   credentials other than the instance profile.
3. Copy the age identity: from the password manager, paste it into a file with mode 600 in a tmpfs directory
   (`/dev/shm`), never into the EBS volume.
4. Download the newest archive and its digest from the backup bucket with the instance role; run
   `ops/restore-drill/run.sh <archive> --expect-sha256 <digest> --age-identity /dev/shm/<file>`.
5. Run the pgTAP RLS suite against the drill stack (printed by the tool).
6. Copy **only** the evidence JSON out (SSM port forwarding or paste; it has counts and times, no PHI).
7. Delete the identity file, `docker system prune -af`, then terminate the instance. Confirm in the console that the
   instance and its volume are gone.

## 4. Record and alert

Drill date, instance id (until terminated), archive id and digest, evidence JSON (RPO 12 h or less, RTO), pgTAP result.
If any step fails: a failure is a defect; open a Sev 2 incident (`incident.md`), fix, repeat within 7 days.

## 5. Cost and safety checks

- A billing alarm at a small monthly threshold on the backup account.
- A weekly check for instances tagged `purpose=restore-drill` older than 1 day: none may exist (terminate).
- The restore bucket policy denies writes from this role.

```
drill date: <date>   archive digest: <digest>   instance terminated: yes/no (time)
RPO (h): <n>   RTO (min): <n>   pgTAP: pass/fail
```
