-- Migration: 000057_policies_admin_system.sql
-- V2-05 plan 05-02c (P1-01, SECURITY_VERIFICATION_PLAN §6.1; rulings R-14, R-40, R-42; threats T-05-11, T-05-39).
--
-- SELECT / INSERT / UPDATE policies of the admin and system tables, set to their target rule from the 05-PLAN "Target
-- policy matrix" and bound to the caller's ACTIVE clinic (R-42), except the two clinic-switcher reads (R-40). Before:
-- "any membership" (`current_user_tenant_ids()`) or an inline owner/admin EXISTS over every clinic the caller belongs
-- to, so a member of clinics A and B acting in A read and wrote B's rows, and every member read every colleague's
-- notifications. After this migration (with 000060 for audit_logs) no policy in `public` calls a legacy helper.
--
--   tenants                    S member helper (every clinic of the caller: the switcher)   U clinic:manage
--   memberships                S own rows in any clinic, or every row of the active clinic (staff:view)
--                              U the active clinic: own row (profile columns: column grants + guard) or clinic:manage
--   invitations                S staff:invite   I staff:invite, created_by = caller, owner/admin roles only by an owner
--   api_keys, api_key_usage_daily, webhook_subscriptions   S/I/U clinic:manage
--   webhook_delivery_queue     S clinic:manage (delivery logs; writes stay with the V2-04 RPCs)
--   tenant_messaging_config    S clinic:view    I/U clinic:manage
--   in_app_notifications       S/U the caller's notices in the active clinic: addressed to them, or (no addressee)
--                              to their role or to everyone; owners/admins also see admin/owner/receptionist notices
--                              (the rule `features/notifications/service.ts` already applies); I none (no app writer
--                              uses a user client; 000059 revokes the privilege)
--   document_share_tokens      S by resource_type: prescription prescriptions:view, invoice billing:view, referral
--                              consultations:view, patient_document labs:view
--   patient_documents          S labs:view      I/U labs:edit (handed over by 05-02b; DELETE labs:edit since 05-04)
--   subscriptions, payment_records (v1, dropped in 05-09c)   S clinic:manage
--
-- DELETE policies are 05-04's (000052) and are not touched. cdci_* / opd_diagnoses keep their catalogue SELECT. The
-- owner check for owner/admin invitations and the role match for notices read `memberships` under the caller's own
-- RLS (own rows are always visible). Each helper call is wrapped in (select ...) (initPlan). Policy-only migration
-- (plus one trigger body): no data is touched.

-- tenants -------------------------------------------------------------------------------------------------------------
DROP POLICY tenants_select_membership ON public.tenants;
DROP POLICY tenants_update_owner_admin ON public.tenants;

CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (id IN (SELECT authz.member_tenant_ids()));
CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE TO authenticated
  USING (id IN (SELECT authz.tenant_ids_with('clinic:manage')))
  WITH CHECK (id IN (SELECT authz.tenant_ids_with('clinic:manage')));

-- memberships ---------------------------------------------------------------------------------------------------------
DROP POLICY memberships_select_tenant ON public.memberships;
DROP POLICY memberships_update_tenant ON public.memberships;

CREATE POLICY memberships_select ON public.memberships
  FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND tenant_id IN (SELECT authz.member_tenant_ids()))
    OR tenant_id IN (SELECT authz.tenant_ids_with('staff:view'))
  );
CREATE POLICY memberships_update ON public.memberships
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.full_tenant_ids())
    AND (user_id = (SELECT auth.uid()) OR tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')))
  )
  WITH CHECK (
    tenant_id IN (SELECT authz.full_tenant_ids())
    AND (user_id = (SELECT auth.uid()) OR tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')))
  );

-- The profile guard's owner exemption moves off `current_user_has_role` (any membership) to the active clinic: the
-- caller is an owner of the row's clinic AND that clinic is the active one. Same body otherwise. The active-clinic test
-- is its own statement: PostgreSQL checks EXECUTE on every function of an expression when the expression starts, so
-- in the first IF it would refuse the service role (which holds no EXECUTE on authz.active_tenant_id) before the
-- `auth.uid() IS NULL` exemption applied.
CREATE OR REPLACE FUNCTION public.memberships_profile_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR OLD.user_id = auth.uid() THEN
        RETURN NEW;
    END IF;
    IF OLD.tenant_id = authz.active_tenant_id()
       AND EXISTS (
           SELECT 1 FROM public.memberships m
            WHERE m.tenant_id = OLD.tenant_id AND m.user_id = auth.uid() AND m.role = 'owner'
       ) THEN
        RETURN NEW;
    END IF;

    IF NEW.qualifications IS DISTINCT FROM OLD.qualifications
       OR NEW.medical_council_reg_no IS DISTINCT FROM OLD.medical_council_reg_no THEN
        RAISE EXCEPTION 'credentials_self_or_owner' USING ERRCODE = '42501';
    END IF;

    IF OLD.role IN ('owner', 'admin')
       AND (NEW.full_name IS DISTINCT FROM OLD.full_name OR NEW.phone IS DISTINCT FROM OLD.phone) THEN
        RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

-- invitations ---------------------------------------------------------------------------------------------------------
DROP POLICY invitations_select_owner_admin ON public.invitations;
DROP POLICY invitations_insert_owner_admin ON public.invitations;

CREATE POLICY invitations_select ON public.invitations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('staff:invite')));
CREATE POLICY invitations_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND consumed_at IS NULL
    AND consumed_by IS NULL
    AND tenant_id IN (SELECT authz.tenant_ids_with('staff:invite'))
    AND (
      role NOT IN ('owner', 'admin')
      OR EXISTS (
        SELECT 1 FROM public.memberships m
         WHERE m.tenant_id = invitations.tenant_id
           AND m.user_id = (SELECT auth.uid())
           AND m.role = 'owner'
      )
    )
  );

-- api_keys, api_key_usage_daily, webhook_subscriptions (clinic:manage) ---------------------------------------------
DROP POLICY api_keys_owner_admin_select ON public.api_keys;
DROP POLICY api_keys_owner_admin_insert ON public.api_keys;
DROP POLICY api_keys_owner_admin_update ON public.api_keys;

CREATE POLICY api_keys_select ON public.api_keys
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
CREATE POLICY api_keys_insert ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
CREATE POLICY api_keys_update ON public.api_keys
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));

DROP POLICY api_key_usage_owner_admin_select ON public.api_key_usage_daily;
DROP POLICY api_key_usage_owner_admin_insert ON public.api_key_usage_daily;
DROP POLICY api_key_usage_owner_admin_update ON public.api_key_usage_daily;

CREATE POLICY api_key_usage_daily_select ON public.api_key_usage_daily
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
CREATE POLICY api_key_usage_daily_insert ON public.api_key_usage_daily
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
CREATE POLICY api_key_usage_daily_update ON public.api_key_usage_daily
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));

DROP POLICY webhook_subs_owner_admin_select ON public.webhook_subscriptions;
DROP POLICY webhook_subs_owner_admin_insert ON public.webhook_subscriptions;
DROP POLICY webhook_subs_owner_admin_update ON public.webhook_subscriptions;

CREATE POLICY webhook_subscriptions_select ON public.webhook_subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
CREATE POLICY webhook_subscriptions_insert ON public.webhook_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
CREATE POLICY webhook_subscriptions_update ON public.webhook_subscriptions
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));

-- webhook_delivery_queue (SELECT only, V2-04 contract) ---------------------------------------------------------------
DROP POLICY webhook_queue_select_owner_admin ON public.webhook_delivery_queue;

CREATE POLICY webhook_delivery_queue_select ON public.webhook_delivery_queue
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));

-- tenant_messaging_config ---------------------------------------------------------------------------------------------
DROP POLICY tenant_messaging_config_tenant_isolation_select ON public.tenant_messaging_config;
DROP POLICY tenant_messaging_config_tenant_isolation_insert ON public.tenant_messaging_config;
DROP POLICY tenant_messaging_config_tenant_isolation_update ON public.tenant_messaging_config;

CREATE POLICY tenant_messaging_config_select ON public.tenant_messaging_config
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:view')));
CREATE POLICY tenant_messaging_config_insert ON public.tenant_messaging_config
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
CREATE POLICY tenant_messaging_config_update ON public.tenant_messaging_config
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));

-- in_app_notifications (T-05-11) ----------------------------------------------------------------------------------------
DROP POLICY in_app_notifications_tenant_isolation_select ON public.in_app_notifications;
DROP POLICY in_app_notifications_tenant_isolation_insert ON public.in_app_notifications;
DROP POLICY in_app_notifications_tenant_isolation_update ON public.in_app_notifications;

CREATE POLICY in_app_notifications_select ON public.in_app_notifications
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT authz.full_tenant_ids())
    AND (
      recipient_user_id = (SELECT auth.uid())
      OR (
        recipient_user_id IS NULL
        AND (
          recipient_role IS NULL
          OR EXISTS (
            SELECT 1 FROM public.memberships m
             WHERE m.tenant_id = in_app_notifications.tenant_id
               AND m.user_id = (SELECT auth.uid())
               AND (
                 m.role = in_app_notifications.recipient_role
                 OR (m.role IN ('owner', 'admin') AND in_app_notifications.recipient_role IN ('owner', 'admin', 'receptionist'))
               )
          )
        )
      )
    )
  );
CREATE POLICY in_app_notifications_update ON public.in_app_notifications
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.full_tenant_ids())
    AND (
      recipient_user_id = (SELECT auth.uid())
      OR (
        recipient_user_id IS NULL
        AND (
          recipient_role IS NULL
          OR EXISTS (
            SELECT 1 FROM public.memberships m
             WHERE m.tenant_id = in_app_notifications.tenant_id
               AND m.user_id = (SELECT auth.uid())
               AND (
                 m.role = in_app_notifications.recipient_role
                 OR (m.role IN ('owner', 'admin') AND in_app_notifications.recipient_role IN ('owner', 'admin', 'receptionist'))
               )
          )
        )
      )
    )
  )
  WITH CHECK (tenant_id IN (SELECT authz.full_tenant_ids()));

-- document_share_tokens (SELECT by resource type; minted and revoked by definer RPCs only) ----------------------------
DROP POLICY doc_tokens_select_tenant ON public.document_share_tokens;

CREATE POLICY document_share_tokens_select ON public.document_share_tokens
  FOR SELECT TO authenticated
  USING (
    (resource_type = 'prescription' AND tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:view')))
    OR (resource_type = 'invoice' AND tenant_id IN (SELECT authz.tenant_ids_with('billing:view')))
    OR (resource_type = 'referral' AND tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')))
    OR (resource_type = 'patient_document' AND tenant_id IN (SELECT authz.tenant_ids_with('labs:view')))
  );

-- patient_documents (labs; 05-02b handover) ---------------------------------------------------------------------------
DROP POLICY patient_documents_tenant_isolation_select ON public.patient_documents;
DROP POLICY patient_documents_tenant_isolation_insert ON public.patient_documents;
DROP POLICY patient_documents_tenant_isolation_update ON public.patient_documents;

CREATE POLICY patient_documents_select ON public.patient_documents
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('labs:view')));
CREATE POLICY patient_documents_insert ON public.patient_documents
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('labs:edit')));
CREATE POLICY patient_documents_update ON public.patient_documents
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('labs:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('labs:edit')));

-- v1 subscriptions / payment_records (dropped in 05-09c) -------------------------------------------------------------
DROP POLICY subscriptions_select_owner_admin ON public.subscriptions;
DROP POLICY payment_records_select_owner_admin ON public.payment_records;

CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
CREATE POLICY payment_records_select ON public.payment_records
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
