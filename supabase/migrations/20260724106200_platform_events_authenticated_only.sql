-- Operational analytics is only emitted by authenticated passenger, driver and
-- admin flows. Removing anon execution reduces spam and storage abuse.

begin;

revoke execute on function public.track_platform_event(
    text,text,text,text,jsonb,text,text,text
) from anon;

grant execute on function public.track_platform_event(
    text,text,text,text,jsonb,text,text,text
) to authenticated;

commit;
