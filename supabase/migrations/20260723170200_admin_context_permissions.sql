create or replace function public.admin_get_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_role text;
    v_require_mfa boolean;
    v_session_minutes integer;
begin
    if not public.higo_is_admin() then
        return jsonb_build_object('authorized', false);
    end if;
    v_role := public.higo_admin_role();
    select require_mfa, session_minutes into v_require_mfa, v_session_minutes
      from public.admin_security_settings where singleton;
    return jsonb_build_object(
        'authorized', true,
        'user_id', auth.uid(),
        'staff_role', v_role,
        'require_mfa', coalesce(v_require_mfa, false),
        'session_minutes', coalesce(v_session_minutes, 60),
        'aal', coalesce(auth.jwt()->>'aal', 'aal1'),
        'permissions', jsonb_build_object(
            'view_dashboard', public.higo_admin_can('view_dashboard'),
            'view_analytics', public.higo_admin_can('view_analytics'),
            'view_users', public.higo_admin_can('view_users'),
            'manage_memberships', public.higo_admin_can('manage_memberships'),
            'manage_drivers', public.higo_admin_can('manage_drivers'),
            'manage_support', public.higo_admin_can('manage_support'),
            'manage_operations', public.higo_admin_can('manage_operations'),
            'manage_pricing', public.higo_admin_can('manage_pricing'),
            'manage_zones', public.higo_admin_can('manage_zones'),
            'manage_disputes', public.higo_admin_can('manage_disputes'),
            'manage_users', v_role = 'super_admin',
            'manage_security', v_role = 'super_admin',
            'manage_promos', v_role = 'super_admin',
            'manage_shop', v_role = 'super_admin'
        )
    );
end;
$$;
