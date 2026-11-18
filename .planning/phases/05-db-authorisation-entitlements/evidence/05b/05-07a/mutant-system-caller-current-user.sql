-- 05-07a mutant: the system-caller rule reads current_user (the SUB 8.1 verbatim pattern R-38 corrects).
CREATE OR REPLACE FUNCTION private.invitation_system_caller()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT current_user::text IN ('service_role', 'postgres')
$$;
