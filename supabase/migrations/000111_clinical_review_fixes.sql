-- 000111_clinical_review_fixes.sql — V2-09a 09A-06a, the review fix round (09A-REVIEW-TRIAGE.md; reviews 09A-REVIEW-A.md and 09A-REVIEW-SEC.md).
--
-- Ruling R-A (CTO delegate, binding): within ADR-0005 (no service-role client on a request path) the Rx PDF archive is written by the SIGNING
-- DOCTOR only. The signer (visits.signed_by = auth.uid()) of the sealed visit is the only writer of the canonical object and of the PDF pair;
-- owners, other doctors, every other role and the service role lose both. Residual (recorded for the PO): the signer could archive bytes that
-- differ from their own sealed record; the sealed rows stay the source of truth (a trusted `rx.archive` job is the V2-14 option).
--
-- Rows fixed here (database side; the app side is in the same fix round):
--  S-1 / A-4  public.patient_documents: no request path updates a lab document (inventory in 09A-NOTES, 09A-06a). The UPDATE policy
--             `patient_documents_update` (000057) is dropped and UPDATE is revoked from `authenticated`, so `storage_path`, `patient_id`,
--             `visit_id`, `uploaded_by`, `title`, `is_abnormal`, ... cannot be rewritten by any member. The service role keeps its grant
--             (no request path; ADR-0005), and the visit FK's ON DELETE SET NULL is unaffected.
--  S-2 / A-1  private.prescriptions_seal_guard: the pair goes NULL -> value once, both columns in one statement, only
--             - for a signed header of a visit proven sealed (a visit the caller cannot see is refused, S-10: RX_PDF_NOT_SEALED),
--             - at the header's own canonical key (RX_PDF_PATH_INVALID),
--             - by the visit's signer on the request path (RX_PDF_SIGNER_ONLY; a writer with no session too),
--             - when the object exists at that key and its storage owner is the signer (RX_PDF_OBJECT_INVALID): an object planted by
--               anyone else is never adopted.
--             The storage policy `prescriptions_rx_insert` additionally requires the caller to be the visit's signer.
--  S-3        A recorded pair whose object is missing may be cleared (both columns, version unchanged) by the signer of the sealed visit
--             only, so the signer's own archive retry is never blocked by a broken pair. Anything else that touches an existing pair is
--             RX_PDF_WRITE_ONCE, as before (finalize still clears it in the statement that raises version).
--  S-4        private.prescriptions_actor_guard: doctor_id, visit_id, patient_id and tenant_id of a header never change, on EVERY path (the
--             service role could graft a draft header onto a sealed visit). The rest is the 000109 text.
--  S-5 / A-2  public.share_token_object also returns the prescription's `pdf_sha256`, so the share link verifies the object before it signs it.
--  A-3        public.reopen_visit_for_amendment refuses RX_ARCHIVE_PENDING (P0001) while the visit's latest signed header has no recorded
--             archive (its PDF could never be written once the visit is reopened). Otherwise the 000099 text.
--  A-5        private.visit_revisions_actor_guard: the snapshot's `visit` object also records `reason_for_visit` and `location_id` (R-6 columns).
--             Otherwise the 000078 text.
--  S-7        public.visit_revisions: the member INSERT policy is dropped and INSERT revoked from `authenticated` (the two definer commands are
--             the writers); CHECK visit_revisions_amendment_reason_length: btrim(amendment_reason) is 10 to 500 characters.
--  S-9        TRUNCATE and TRIGGER revoked on the sealed tables from service_role, authenticated and anon (TRUNCATE fires no row trigger).
--             The table owner (postgres) keeps them: R-3 residual, with session_replication_role and DISABLE TRIGGER.
--  S-10       See S-2: the pair branch needs a positive proof that the visit is sealed, never "not visible = sealed".
--
-- No data change. New refusal names (42501, fixed, no row data): RX_PDF_SIGNER_ONLY, RX_PDF_OBJECT_INVALID; new command reason RX_ARCHIVE_PENDING
-- (P0001). Per-migration checklist: the trigger functions are INVOKER with search_path '' and qualified names (visit_revisions_actor_guard stays
-- the definer it was), EXECUTE revoked from PUBLIC and the API roles; the replaced command keeps the V2-07 pattern, its signature and its grants;
-- each replaced body starts from its latest definition (000109, 000099, 000078, 000090) and changes only what is named above.

-- S-1 / A-4: lab documents are not updated by any member -----------------------------------------------------------------------------------
DROP POLICY patient_documents_update ON public.patient_documents;
REVOKE UPDATE ON public.patient_documents FROM authenticated;

-- S-2, S-3, S-10: the PDF pair is the signer's, set once, only for an object the signer stored --------------------------------------------
CREATE OR REPLACE FUNCTION private.prescriptions_seal_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_sealed boolean;
    v_signer uuid;
    v_proven boolean;
BEGIN
    IF v_uid IS NOT NULL THEN
        -- A visit the caller cannot see counts as sealed (fail closed) for the seal rule; the pair rule below needs a positive proof.
        v_sealed := NOT EXISTS (SELECT 1 FROM public.visits v
                                 WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.visit_id
                                   AND (v.signed_at IS NULL OR v.status = 'in_consultation'));
    ELSE
        v_sealed := EXISTS (SELECT 1 FROM public.visits v
                             WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.visit_id
                               AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation');
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF NOT v_sealed THEN
            RETURN OLD;
        END IF;
        -- R-4a: the cascade of a tenant purge.
        IF v_uid IS NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'RX_SEALED' USING ERRCODE = '42501';
    END IF;

    -- UPDATE. R-8, narrowed by R-12: while the visit is sealed only updated_at and the PDF pair may change; letterhead_mode is frozen.
    IF v_sealed
       AND (to_jsonb(NEW) - 'updated_at' - 'pdf_storage_path' - 'pdf_sha256')
           IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'pdf_storage_path' - 'pdf_sha256') THEN
        RAISE EXCEPTION 'RX_SEALED' USING ERRCODE = '42501';
    END IF;

    -- R-12: a version change never carries a pair (finalize clears it): the pair is always the canonical key of the row's own version.
    IF NEW.version IS DISTINCT FROM OLD.version AND (NEW.pdf_storage_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL) THEN
        RAISE EXCEPTION 'RX_PDF_PATH_INVALID' USING ERRCODE = '42501';
    END IF;
    IF NEW.pdf_storage_path IS NOT DISTINCT FROM OLD.pdf_storage_path AND NEW.pdf_sha256 IS NOT DISTINCT FROM OLD.pdf_sha256 THEN
        RETURN NEW;
    END IF;

    -- The visit's signer, only when the visit is proven sealed (signed, not reopened) and visible to this writer (S-10).
    SELECT v.signed_by INTO v_signer
      FROM public.visits v
     WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
       AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation';
    v_proven := FOUND;

    IF OLD.pdf_storage_path IS NOT NULL OR OLD.pdf_sha256 IS NOT NULL THEN
        -- An existing pair never changes. It is cleared (both columns) only
        --  (a) by the statement that raises the version (the amendment's finalize), or
        --  (b) 000111 (S-3): by the signer of the sealed visit, at the same version, when the recorded object no longer exists, so the signer's
        --      own archive retry is never blocked by a broken pair.
        IF NEW.pdf_storage_path IS NULL AND NEW.pdf_sha256 IS NULL THEN
            IF NEW.version > OLD.version THEN
                RETURN NEW;
            END IF;
            IF v_uid IS NOT NULL AND v_proven AND v_signer = v_uid AND OLD.pdf_storage_path IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM storage.objects o
                                WHERE o.bucket_id = 'prescriptions' AND o.name = OLD.pdf_storage_path) THEN
                RETURN NEW;
            END IF;
        END IF;
        RAISE EXCEPTION 'RX_PDF_WRITE_ONCE' USING ERRCODE = '42501';
    END IF;

    -- NULL to a value: once, both columns together, for a signed header of a visit proven sealed, at its own canonical key, by the signer, for an
    -- object the signer stored there (ruling R-A).
    IF NOT v_proven OR NEW.signed_at IS NULL THEN
        RAISE EXCEPTION 'RX_PDF_NOT_SEALED' USING ERRCODE = '42501';
    END IF;
    IF NEW.pdf_storage_path IS NULL OR NEW.pdf_sha256 IS NULL
       OR NEW.pdf_storage_path IS DISTINCT FROM (NEW.tenant_id::text || '/' || NEW.visit_id::text || '/rx_v' || NEW.version::text || '.pdf') THEN
        RAISE EXCEPTION 'RX_PDF_PATH_INVALID' USING ERRCODE = '42501';
    END IF;
    IF v_uid IS NULL OR v_signer IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'RX_PDF_SIGNER_ONLY' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o
                    WHERE o.bucket_id = 'prescriptions' AND o.name = NEW.pdf_storage_path
                      AND coalesce(o.owner_id, o.owner::text) = v_uid::text) THEN
        RAISE EXCEPTION 'RX_PDF_OBJECT_INVALID' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.prescriptions_seal_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.prescriptions_seal_guard() IS
    'V2-09a 09A-02 (R-8), 000109 (R-12), 000111 (ruling R-A; S-2, S-3, S-10): BEFORE UPDATE OR DELETE on prescriptions, every writer. While the visit is sealed '
    'a header changes only in updated_at and the PDF pair, and is deleted by nobody except the cascade of a tenant purge (RX_SEALED). The PDF pair: set once '
    'from NULL, both columns in one statement, only for a signed header of a visit proven sealed (RX_PDF_NOT_SEALED), at <tenant>/<visit>/rx_v<version>.pdf '
    '(RX_PDF_PATH_INVALID), by the visit''s signer (RX_PDF_SIGNER_ONLY) and only for an object the signer stored at that key (RX_PDF_OBJECT_INVALID). An existing '
    'pair never changes (RX_PDF_WRITE_ONCE); it is cleared only by a statement that raises version, or by the signer when its object is missing. 42501.';

-- S-4: a header's keys never change, on every path ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prescriptions_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- 000109 (R-12): a new header has not been signed, so it has nothing archived.
        IF NEW.pdf_storage_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL THEN
            RAISE EXCEPTION 'RX_PDF_NOT_SEALED' USING ERRCODE = '42501';
        END IF;
        IF v_uid IS NULL THEN
            -- 000108 (R-8, R-3): the system path meets the same seal; a visit that does not exist is not sealed (the FK refuses it).
            IF EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
                          AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation') THEN
                RAISE EXCEPTION 'PRESCRIPTION_VISIT_SIGNED' USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END IF;
        IF NEW.doctor_id IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'PRESCRIPTION_DOCTOR_NOT_CALLER' USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id AND v.patient_id = NEW.patient_id) THEN
            RAISE EXCEPTION 'PRESCRIPTION_PATIENT_MISMATCH' USING ERRCODE = '42501';
        END IF;
        -- 05-11e (NF-2): a header is added only while the visit is unsigned or reopened for amendment.
        IF NOT EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
                          AND (v.signed_at IS NULL OR v.status = 'in_consultation')) THEN
            RAISE EXCEPTION 'PRESCRIPTION_VISIT_SIGNED' USING ERRCODE = '42501';
        END IF;
        -- 000108 (I-1, R-8): a request path writes the first version only; later versions come from the amendment command.
        IF NEW.version IS DISTINCT FROM 1 THEN
            RAISE EXCEPTION 'PRESCRIPTION_VERSION_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;
    -- 000111 (S-4): doctor, visit, patient and clinic of a header never change, for EVERY writer (the service role could otherwise move a draft
    -- header onto a sealed visit, or into another clinic).
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.visit_id IS DISTINCT FROM OLD.visit_id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'PRESCRIPTION_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.prescriptions_actor_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.prescriptions_actor_guard() IS
    'V2-05 05-11a/05-11e, V2-09a 000108/000109/000111 (M-ACTOR, NF-2, I-1, R-8, R-12, S-4): a header is never added to a sealed visit by any writer and is added '
    'with no PDF pair; a signed-in caller prescribes only as itself, for the visit''s own patient, only while the visit is unsigned or reopened, and only as '
    'version 1; doctor, visit, patient and clinic of a prescription never change, for every writer. 42501.';

-- S-2: only the signer stores the canonical Rx object -------------------------------------------------------------------------------------
DROP POLICY prescriptions_rx_insert ON storage.objects;
CREATE POLICY prescriptions_rx_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/rx_v[0-9]{1,9}\.pdf$'
    AND split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('prescriptions:edit') t)
    -- 000109 (R-13): the object is the PDF of a header that exists, is signed, has no archived PDF yet and belongs to a sealed visit, at exactly its version;
    -- 000111 (R-A): and the caller is the visit's signer.
    AND EXISTS (
      SELECT 1
        FROM public.prescriptions p
        JOIN public.visits v ON v.tenant_id = p.tenant_id AND v.id = p.visit_id
       WHERE p.tenant_id::text = split_part(name, '/', 1)
         AND p.visit_id::text = split_part(name, '/', 2)
         AND 'rx_v' || p.version::text || '.pdf' = split_part(name, '/', 3)
         AND p.signed_at IS NOT NULL
         AND p.pdf_sha256 IS NULL
         AND v.signed_at IS NOT NULL
         AND v.status <> 'in_consultation'
         AND v.signed_by = (SELECT auth.uid())
    )
  );

-- S-5 / A-2: the share link gets the recorded hash ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.share_token_object(p_token text, p_kinds text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v_rid UUID;
    v_res JSONB;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s WHERE s.token_hash = public.share_token_hash(p_token);

    IF NOT FOUND
       OR t.resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral')
       OR p_kinds IS NULL
       OR NOT (t.resource_type = ANY (p_kinds))
       OR t.revoked_at IS NOT NULL
       OR t.expires_at <= now()
       -- 05-10a (SUB-02, R-28): nothing of a clinic whose access level is not `full` is signed or rendered.
       OR billing_internal.tenant_access_level(t.tenant_id, now()) IS DISTINCT FROM 'full' THEN
        RETURN NULL;
    END IF;

    v_rid := COALESCE(t.resource_id, CASE WHEN t.resource_type = 'patient_document' THEN t.document_id END);
    v_res := public.share_token_resource(t.tenant_id, t.resource_type, v_rid);
    IF v_res IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'tenant_id', t.tenant_id,
        'resource_type', t.resource_type,
        'resource_id', v_rid,
        'bucket', v_res ->> '_bucket',
        'storage_path', v_res ->> '_storage_path',
        'original_filename', v_res ->> 'original_filename',
        -- 000111 (S-5): the archived prescription's recorded SHA-256 (NULL until the signed version is archived); the share link checks the object against it.
        'sha256', CASE WHEN t.resource_type = 'prescription'
                       THEN (SELECT r.pdf_sha256 FROM public.prescriptions r WHERE r.id = v_rid AND r.tenant_id = t.tenant_id) END
    );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.share_token_object(TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_token_object(TEXT, TEXT[]) TO service_role;

-- A-3: no reopen while the signed version has no archive -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_visit_for_amendment(p_tenant_id uuid, p_visit_id uuid, p_reason text, p_client_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_reason text := btrim(p_reason);
    v_replay jsonb;
    v_visit record;
    v_revision integer;
    v_result jsonb;
BEGIN
    -- 1. Actor.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then consultations:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- 000099 (F-2): the reopen writes the revision (consultations) and the visit's status (appointments).
    IF NOT (public.has_permission(p_tenant_id, 'consultations:edit') AND public.has_permission(p_tenant_id, 'appointments:edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Input: the reason is recorded for the medical audit (at least 10 characters) and is part of the audit row, whose
    -- values are bounded at 500 characters.
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION 'AMENDMENT_REASON_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.reopen_visit_for_amendment',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'reason', v_reason)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit; it must be signed and completed (an amendment records a signed version, NF-1).
    SELECT v.status, v.signed_at INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_visit.status IS DISTINCT FROM 'completed' OR v_visit.signed_at IS NULL THEN
        RAISE EXCEPTION 'VISIT_NOT_SIGNED' USING ERRCODE = 'P0001';
    END IF;
    -- 000111 (A-3): the signed version's PDF must be archived first. Once the visit is reopened it is no longer sealed, the archive of that
    -- version is refused for good, and the finalize raises the version: a signed Rx would be left with no PDF at all. The latest header is the
    -- one the finalize re-signs and the one the archive writes; one with a signature and no recorded hash is pending.
    IF EXISTS (SELECT 1
                 FROM (SELECT p.signed_at, p.pdf_sha256
                         FROM public.prescriptions p
                        WHERE p.tenant_id = p_tenant_id AND p.visit_id = p_visit_id
                        ORDER BY p.version DESC
                        LIMIT 1) h
                WHERE h.signed_at IS NOT NULL AND h.pdf_sha256 IS NULL) THEN
        RAISE EXCEPTION 'RX_ARCHIVE_PENDING' USING ERRCODE = 'P0001';
    END IF;

    -- 5. Writes. The revision's number and snapshot are filled by the database under the visit lock
    --    (visit_revisions_actor_guard); the reopen is admitted only after this caller's snapshot row (visits_integrity_guard).
    INSERT INTO public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    VALUES (p_tenant_id, p_visit_id, v_uid, v_reason)
    RETURNING revision_number INTO v_revision;

    UPDATE public.visits SET status = 'in_consultation', updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.reopen_for_amendment', 'visit', p_visit_id,
                             jsonb_build_object('revision_number', v_revision, 'amendment_reason', v_reason));

    v_result := jsonb_build_object('visit_id', p_visit_id, 'revision_number', v_revision, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.reopen_visit_for_amendment(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_visit_for_amendment(uuid, uuid, text, uuid) TO authenticated;
COMMENT ON FUNCTION public.reopen_visit_for_amendment(uuid, uuid, text, uuid) IS
    'V2-07 07-01 (R-1), V2-09a 000111 (A-3): reopens a signed, completed visit for amendment in one transaction: the revision row (database number and snapshot), the visit back to in_consultation, the visit.reopen_for_amendment audit row. consultations:edit + appointments:edit (000099 F-2). AMENDMENT_REASON_INVALID (10-500 characters), VISIT_NOT_SIGNED, RX_ARCHIVE_PENDING (the latest signed prescription has no archived PDF yet) (P0001). Idempotent by p_client_request_id. Result: visit_id, revision_number, replayed.';

-- A-5: the snapshot records reason_for_visit and location_id ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.visit_revisions_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_visit record;
    v_notes record;
    v_prev integer;
BEGIN
    IF v_uid IS NOT NULL THEN
        -- The insert policy's own predicate, checked first: nothing is read or locked for a caller it would refuse.
        IF NOT public.has_permission(NEW.tenant_id, 'consultations:edit') THEN
            RAISE EXCEPTION 'AMENDMENT_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        IF NEW.amended_by IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'AMENDMENT_AUTHOR_NOT_CALLER' USING ERRCODE = '42501';
        END IF;
        NEW.amended_at := now();
    END IF;

    -- Serialise amendments of one visit: the state check, the number and the snapshot are read under the visit row lock.
    SELECT v.id, v.tenant_id, v.status, v.signed_at, v.signed_by, v.specialty, v.scheduled_at, v.current_revision,
           v.reason_for_visit, v.location_id
      INTO v_visit
      FROM public.visits v
     WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RETURN NEW; -- the composite FK refuses the row
    END IF;

    -- 05-11e (NF-1): an amendment row records a signed version; it cannot be written ahead of a signature.
    IF v_uid IS NOT NULL AND (v_visit.signed_at IS NULL OR v_visit.status IS DISTINCT FROM 'completed') THEN
        RAISE EXCEPTION 'AMENDMENT_VISIT_NOT_SIGNED' USING ERRCODE = '42501';
    END IF;

    SELECT coalesce(max(r.revision_number), 0) INTO v_prev
      FROM public.visit_revisions r
     WHERE r.tenant_id = NEW.tenant_id AND r.visit_id = NEW.visit_id;
    NEW.revision_number := greatest(v_prev + 1, v_visit.current_revision);

    SELECT n.vitals, n.chief_complaints, n.clinical_notes, n.specialty_data, n.advice, n.investigations_advised
      INTO v_notes
      FROM public.clinical_notes n
     WHERE n.tenant_id = NEW.tenant_id AND n.visit_id = NEW.visit_id;

    NEW.snapshot := jsonb_build_object(
        'captured_by', 'database',
        'visit', jsonb_build_object(
            'status', v_visit.status,
            'signed_at', v_visit.signed_at,
            'signed_by', v_visit.signed_by,
            'specialty', v_visit.specialty,
            -- 000078 (NF-4): the visit date printed on the signed record.
            'scheduled_at', v_visit.scheduled_at,
            -- 000111 (A-5): the other R-6 columns locked while sealed (unlocked while amending, so the signed value lives here).
            'reason_for_visit', v_visit.reason_for_visit,
            'location_id', v_visit.location_id,
            'vitals', v_notes.vitals,
            'chief_complaints', v_notes.chief_complaints,
            'clinical_notes', v_notes.clinical_notes,
            'specialty_data', v_notes.specialty_data,
            'advice', to_jsonb(v_notes.advice),
            'investigations_advised', to_jsonb(v_notes.investigations_advised)),
        'diagnoses', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at, d.id)
                                 FROM public.consultation_diagnoses d
                                WHERE d.tenant_id = NEW.tenant_id AND d.visit_id = NEW.visit_id), '[]'::jsonb),
        -- 05-11e (NF-2): every prescription of the visit with its items, so no header can steer the record away from
        -- the signed medicines.
        'prescriptions', coalesce((SELECT jsonb_agg(
                                              to_jsonb(p) || jsonb_build_object('items',
                                                  coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at, i.id)
                                                              FROM public.prescription_items i
                                                             WHERE i.tenant_id = p.tenant_id AND i.prescription_id = p.id),
                                                           '[]'::jsonb))
                                              ORDER BY p.version, p.created_at, p.id)
                                     FROM public.prescriptions p
                                    WHERE p.tenant_id = NEW.tenant_id AND p.visit_id = NEW.visit_id), '[]'::jsonb),
        -- The 05-11d key (the latest prescription), kept for its readers; `prescriptions` is the complete record.
        'prescription', (SELECT to_jsonb(p) || jsonb_build_object('items',
                                    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at, i.id)
                                                FROM public.prescription_items i
                                               WHERE i.tenant_id = p.tenant_id AND i.prescription_id = p.id), '[]'::jsonb))
                           FROM public.prescriptions p
                          WHERE p.tenant_id = NEW.tenant_id AND p.visit_id = NEW.visit_id
                          ORDER BY p.version DESC, p.created_at DESC, p.id
                          LIMIT 1),
        'follow_ups', coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.created_at, f.id)
                                  FROM public.follow_ups f
                                 WHERE f.tenant_id = NEW.tenant_id AND f.visit_id = NEW.visit_id), '[]'::jsonb));
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.visit_revisions_actor_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visit_revisions_actor_guard() IS
    'V2-05 05-11a/05-11d/05-11e/000078, V2-09a 000111 (M-ACTOR, N-2, N-8, NF-1, NF-2, NF-4, A-5): an amendment row is written by a '
    'consultations:edit holder as itself, only on a signed, completed visit; on every path its snapshot is the visit''s '
    'current content (signature, specialty, visit date, reason for visit, location, notes, diagnoses, every prescription with its items, follow-ups) '
    'and its number the previous + 1, filled here under the visit row lock (client values ignored). SECURITY DEFINER: '
    'the snapshot does not depend on what the caller may read. 42501.';

-- S-7: amendment rows are written by the commands only, with a bounded reason ------------------------------------------------------------
DROP POLICY visit_revisions_insert ON public.visit_revisions;
REVOKE INSERT ON public.visit_revisions FROM authenticated;
ALTER TABLE public.visit_revisions ADD CONSTRAINT visit_revisions_amendment_reason_length
    CHECK (char_length(btrim(amendment_reason)) BETWEEN 10 AND 500) NOT VALID;
ALTER TABLE public.visit_revisions VALIDATE CONSTRAINT visit_revisions_amendment_reason_length;

-- S-9: no TRUNCATE (no row trigger fires) and no TRIGGER privilege on the sealed tables -------------------------------------------------------
REVOKE TRUNCATE, TRIGGER ON public.visits, public.clinical_notes, public.prescriptions, public.prescription_items,
    public.consultation_diagnoses, public.follow_ups, public.visit_revisions, public.patient_documents
    FROM service_role, authenticated, anon;
