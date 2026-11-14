# Runbook: referral directory and export key scope

V2-05 plan 05-06 (P1-10, P1-11; ruling R-35; migration `000062_referrals_directory_consent`). The UI for both settings
comes with the staff/clinic settings rework (V2-11); until then they are set with one SQL statement. Agents never run
these against a hosted project: the PO (or an operator with the PO's approval) runs them in the Supabase SQL editor of
the intended environment. Synthetic or pilot data only.

## How it works

- `tenants.referral_directory_listed` (default `false`) is a clinic's opt-in to **receive** in-network referrals.
- A referral's `target_tenant_id` must name a listed clinic other than the referring one; otherwise the database
  refuses the write with `REFERRAL_TARGET_NOT_LISTED` (every writer: app, `/api/v1`, SQL). A history snapshot needs the
  patient's consent (`REFERRAL_CONSENT_REQUIRED`).
- Clinicians with `consultations:edit` find listed clinics through `public.referral_directory_search(p_query)` (id and
  name only, at most 20, never their own clinic).
- Unlisting a clinic stops new referrals to it; referrals it already received stay visible and can be acknowledged.
- An owner or admin (`clinic:manage`) of the clinic may change the flag through the app's tenants UPDATE policy; the
  statements below are the operator path.

## List (or unlist) a pilot clinic

```sql
update public.tenants set referral_directory_listed = true where id = '<clinic uuid>';
```

Use `false` to unlist. Check: `select id, name, referral_directory_listed from public.tenants where id = '<clinic uuid>';`

## Allow an API key to export patient records (`/api/v1`, off in production per PO-16)

The `/api/v1/patients/{id}/export` route answers 403 unless the key has the `exports:create` scope (closed set; any other
value is refused by the `api_keys_scopes_known` check):

```sql
update public.api_keys set scopes = array['exports:create'] where id = '<api key uuid>' and revoked_at is null;
```

Remove it with `scopes = '{}'`.
