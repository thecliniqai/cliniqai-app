# ClinicQ Operational Runbook: Database & Storage Backup & Disaster Recovery (DR)

> **Document Version:** 1.0  
> **Last Verified:** 2026-11-09 (Phase 06 Launch Readiness)  
> **Applicability:** Production, Staging, and Multi-Tenant Disaster Recovery  
> **SLA Targets:** Recovery Time Objective (RTO) < 2 Hours | Recovery Point Objective (RPO) < 15 Minutes

---

## 1. Executive Summary & Recovery SLAs

ClinicQ manages sensitive electronic health records (EHR), prescription schedules, clinical encounters, and billing transactions. High availability and business continuity require robust backup topologies, automated physical WAL archiving, and verified point-in-time recovery (PITR) procedures.

| Objective | Target SLA | Implementation Mechanism |
|-----------|------------|--------------------------|
| **RPO (Recovery Point Objective)** | **< 15 minutes** | Supabase continuous PostgreSQL Write-Ahead Log (WAL) archiving to durable physical object storage |
| **RTO (Recovery Time Objective)** | **< 2 hours** | Managed PITR restoration to new database instance or roll-forward standby recovery |
| **Data Retention (Clinical)** | **3 Years (Minimum)** | NMC Regulation 1.3.1 statutory retention requirement reconciled with DPDP Act §12(3) |
| **Physical Backup Retention** | **7 Days Continuous** | Supabase Pro 7-Day Point-In-Time Recovery Window (to the exact second) |
| **Logical Backup Cadence** | **Daily / Monthly** | Automated schema + table data logical dumps (`pg_dump`) stored in encrypted cold storage |

---

## 2. Backup Architecture & Storage Topology

```
                  ┌──────────────────────────────────────────┐
                  │          ClinicQ Application Core        │
                  └────────────────────┬─────────────────────┘
                                       │
                      ┌────────────────┴────────────────┐
                      ▼                                 ▼
         ┌─────────────────────────┐       ┌─────────────────────────┐
         │   PostgreSQL Database   │       │  Object Storage Bucket  │
         │   (Managed Supabase)    │       │     (clinic-records)    │
         └────────────┬────────────┘       └────────────┬────────────┘
                      │                                 │
         ┌────────────┴────────────┐       ┌────────────┴────────────┐
         │                         │       │                         │
         ▼                         ▼       ▼                         ▼
┌──────────────────┐    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Daily Physical  │    │ Continuous WAL   │  │ Primary Storage  │  │ Cross-Region S3  │
│    Snapshots     │    │ Streaming (PITR) │  │  (Supabase/R2)   │  │   Cold Replica   │
│  (7-Day Rolling) │    │  (Second-Level)  │  │ (Encrypted AES)  │  │ (Object Version) │
└──────────────────┘    └──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## 3. Automated Physical Backups & Point-In-Time Recovery (PITR)

### 3.1 Architecture
- **Physical Snapshots:** Created automatically every 24 hours at 00:00 UTC by Supabase infrastructure.
- **Continuous Archiving:** PostgreSQL WAL logs are continuously streamed to durable block storage.
- **Restoration Precision:** Any discrete timestamp within the rolling 7-day retention window can be restored down to the exact second (e.g. `2026-11-09T14:22:05Z`).

### 3.2 Point-In-Time Recovery Runbook (Disaster Recovery Drill)

When recovering from accidental data corruption, ransomware, or infrastructure disruption:

1. **Access Supabase Management Console:**
   - Navigate to `Database Settings` → `Backups` → `Point in Time Recovery`.
2. **Select Target Recovery Timestamp:**
   - Choose a timestamp immediately prior to the incident (e.g. 5 minutes before disruption).
3. **Execute Clone / In-Place Restore:**
   - For non-destructive verification: Launch a **Cloned Database Instance** at target timestamp.
   - Run verification smoke tests against the clone (verifying tenant isolation, patient records, visits, and prescriptions).
4. **Traffic Cutover:**
   - Update Vercel environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) with the restored instance connection strings.
   - Verify health probes:
     ```bash
     curl -i https://clinicos.in/api/health
     curl -i https://clinicos.in/api/ready
     ```

---

## 4. Logical Backups & Tenant Export Procedures (`pg_dump`)

Logical backups provide schema and row-level portability, enabling isolated tenant offboarding, legal compliance audits, and local disaster recovery.

### 4.1 Full Schema Logical Dump

Extract database schema including all tables, indexes, constraints, and Row Level Security (RLS) policies:

```bash
# Dump complete schema without table data
pg_dump \
  --dbname="${DATABASE_URL}" \
  --schema=public \
  --schema-only \
  --no-owner \
  --no-privileges \
  > backup_schema_$(date +%Y%m%d).sql
```

### 4.2 Full Database Logical Backup (Schema + Data)

```bash
# Compressed custom-format dump
pg_dump \
  --dbname="${DATABASE_URL}" \
  --schema=public \
  --format=custom \
  --compress=9 \
  --file=clinicos_backup_$(date +%Y%m%d_%H%M%S).dump
```

### 4.3 Tenant-Specific Logical Export (DPDP Offboarding / Compliance)

When a specific clinic tenant terminates their subscription or requests complete data export under DPDP Act 2023:

```bash
# Export single tenant records across relational tables using COPY with tenant_id filter
psql "${DATABASE_URL}" -c "
  COPY (SELECT * FROM public.tenants WHERE id = '${TENANT_ID}') TO STDOUT WITH CSV HEADER;
" > tenant_metadata.csv

psql "${DATABASE_URL}" -c "
  COPY (SELECT * FROM public.patients WHERE tenant_id = '${TENANT_ID}') TO STDOUT WITH CSV HEADER;
" > tenant_patients.csv

psql "${DATABASE_URL}" -c "
  COPY (SELECT * FROM public.visits WHERE tenant_id = '${TENANT_ID}') TO STDOUT WITH CSV HEADER;
" > tenant_visits.csv

psql "${DATABASE_URL}" -c "
  COPY (SELECT * FROM public.prescriptions WHERE tenant_id = '${TENANT_ID}') TO STDOUT WITH CSV HEADER;
" > tenant_prescriptions.csv
```

---

## 5. Object Storage Backup & Replication (`clinic-records`)

Medical documents (uploaded laboratory reports, referral letters, and signed prescription PDFs) reside in the private bucket `clinic-records` under strict tenant path isolation: `tenants/{tenantId}/{category}/{entityId}/{filename}`.

### 5.1 Cloudflare R2 / AWS S3 Cross-Region Replication
- When `STORAGE_PROVIDER=r2` or `STORAGE_PROVIDER=supabase`, cross-region bucket replication is configured on the cloud provider bucket:
  - **Primary Region:** Mumbai / APAC (`ap-south-1` or Cloudflare WNAM)
  - **Replica Region:** Frankfurt / Singapore (`eu-central-1` / APAC)
  - **Bucket Versioning:** Enabled to prevent malicious or accidental overwrite of historical clinical reports.

### 5.2 Nightly Bucket Backup Sync Script

```bash
#!/usr/bin/env bash
set -euo pipefail

# Sync clinic-records object storage to encrypted secondary backup bucket
BACKUP_DATE=$(date -u +"%Y%m%d")
echo "[BACKUP] Starting object storage sync for date: ${BACKUP_DATE}..."

aws s3 sync \
  s3://clinic-records \
  s3://clinicos-cold-archive-backups/${BACKUP_DATE}/ \
  --exact-timestamps \
  --delete=false

echo "[BACKUP] Storage sync completed successfully."
```

---

## 6. Restoration Verification & Integrity Validation Drill

Every quarterly disaster recovery audit requires executing the following restoration integrity checks:

### 6.1 Database Schema & Data Integrity Checklist
1. **Schema Integrity:** Verify all 18 database migrations (`000001` through `000018`) exist in `supabase_migrations`.
2. **RLS Policy Attachment:** Verify Row Level Security is active on every tenant-owned table:
   ```sql
   SELECT relname, relrowsecurity 
   FROM pg_class 
   WHERE relname IN ('patients', 'visits', 'prescriptions', 'api_keys', 'webhook_delivery_queue');
   ```
3. **Foreign Key Integrity:** Verify referential integrity between `visits.patient_id` → `patients.id` and `prescriptions.visit_id` → `visits.id`.
4. **Statutory Preservation:** Verify erased patient records retain soft-delete flag (`status = 'erased'`, `is_deleted = true`) and associated encounters are fully preserved per NMC Regulation 1.3.1.
5. **Credential Security:** Ensure API keys (`api_keys.key_hash`) and passwords remain cryptographically hashed with zero plaintext exposures.

---

## 7. Emergency Contacts & Escalation Matrix

| Role | Responsibility | Escalation Target |
|------|----------------|-------------------|
| **Incident Commander** | DR Execution & Status Communication | devops@clinicos.in |
| **Database Administrator** | PITR & PostgreSQL Restoration | dba@clinicos.in |
| **Security Officer** | DPDP Compliance & Data Breach Audit | security@clinicos.in |
