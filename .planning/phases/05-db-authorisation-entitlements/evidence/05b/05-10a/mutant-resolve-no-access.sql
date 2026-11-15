CREATE OR REPLACE FUNCTION public.resolve_share_token(p_token text, p_kinds text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v_rid UUID;
    v_res JSONB;
    v_clinic JSONB;
    v_level TEXT;
    v_sub_status TEXT;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token)
    FOR UPDATE;

    IF NOT FOUND
       OR t.resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral')
       OR p_kinds IS NULL
       OR NOT (t.resource_type = ANY (p_kinds)) THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    -- 05-10a (SUB-02, SUB-D6): the clinic's access level decides before anything of the resource is read.
    v_level := billing_internal.tenant_access_level(t.tenant_id, now());

    v_rid := COALESCE(t.resource_id, CASE WHEN t.resource_type = 'patient_document' THEN t.document_id END);

    SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address, 'logo_url', c.logo_url)
    INTO v_clinic
    FROM public.tenants c
    WHERE c.id = t.tenant_id;

    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked', 'clinic', v_clinic - 'address' - 'logo_url');
    END IF;

    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired', 'clinic', v_clinic - 'address' - 'logo_url');
    END IF;

    v_res := public.share_token_resource(t.tenant_id, t.resource_type, v_rid);
    IF v_res IS NULL THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;


    UPDATE public.document_share_tokens
    SET access_count = access_count + 1,
        last_accessed_at = now()
    WHERE id = t.id;

    RETURN (v_res - '_bucket' - '_storage_path') || jsonb_build_object(
        'status', 'ok',
        'access', v_level,
        'resource_type', t.resource_type,
        'expires_at', t.expires_at,
        'clinic', v_clinic
    );
END;
$function$;