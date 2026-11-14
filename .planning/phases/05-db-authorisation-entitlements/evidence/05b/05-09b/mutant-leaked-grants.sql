grant execute on function platform.set_comp(uuid, timestamptz, text, uuid) to anon;
grant execute on function public.is_platform_admin() to anon;
grant insert on public.platform_audit_log to service_role;
grant select on public.platform_admins to authenticated;
