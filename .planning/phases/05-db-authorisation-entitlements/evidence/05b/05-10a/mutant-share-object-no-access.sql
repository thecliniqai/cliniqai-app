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
       OR t.expires_at <= now() THEN
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
        'original_filename', v_res ->> 'original_filename'
    );
END;
$function$;