-- Read-only inventory. No application rows, function bodies or secret values.
-- Compare the same query on source and candidate; this is not a restorable dump.
with relations as (
 select c.*, n.nspname
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p','v','m','S')
 and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
), objects as (
 select 'relation' as kind, format('%I.%I',r.nspname,r.relname) as key,
 jsonb_build_object('type',r.relkind,'owner',pg_get_userbyid(r.relowner),'rls',r.relrowsecurity,
 'forceRls',r.relforcerowsecurity,'persistence',r.relpersistence,
 'options',(select jsonb_agg(v order by v) from unnest(r.reloptions) v),
 'acl',(select jsonb_agg(v::text order by v::text) from unnest(r.relacl) v),
 'viewHash',case when r.relkind in ('v','m') then md5(pg_get_viewdef(r.oid,true)) end) as signature
 from relations r
 union all
 select 'column',format('%I.%I.%I',r.nspname,r.relname,a.attname),
 jsonb_build_object('position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
 'identity',a.attidentity,'generated',a.attgenerated,'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid)),
 'collation',case when a.attcollation<>0 then a.attcollation::regcollation::text end,
 'acl',(select jsonb_agg(v::text order by v::text) from unnest(a.attacl) v))
 from relations r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=r.oid and d.adnum=a.attnum where r.relkind<>'S'
 union all
 select 'constraint',format('%I.%I.%I',r.nspname,r.relname,c.conname),
 jsonb_build_object('type',c.contype,'definitionHash',md5(pg_get_constraintdef(c.oid,true)),
 'validated',c.convalidated,'deferrable',c.condeferrable,'initiallyDeferred',c.condeferred)
 from relations r join pg_constraint c on c.conrelid=r.oid
 union all
 select 'index',format('%I.%I',r.nspname,c.relname),
 jsonb_build_object('definitionHash',md5(pg_get_indexdef(i.indexrelid)),'valid',i.indisvalid,'ready',i.indisready)
 from relations r join pg_index i on i.indrelid=r.oid join pg_class c on c.oid=i.indexrelid
 union all
 select 'function',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
 jsonb_build_object('bodyHash',md5(p.prosrc),'language',l.lanname,'returns',pg_get_function_result(p.oid),
 'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'volatility',p.provolatile,
 'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,
 'defaultsHash',md5(pg_get_expr(p.proargdefaults,0)),
 'configHash',md5(array_to_string(p.proconfig,E'\n')),
 'acl',(select jsonb_agg(v::text order by v::text) from unnest(p.proacl) v))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname='public' and p.prokind in ('f','p')
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 union all
 select 'policy',format('%I.%I.%I',n.nspname,c.relname,p.polname),
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
 'roles',(select jsonb_agg(case when roleid=0 then 'PUBLIC' else pg_get_userbyid(roleid) end order by case when roleid=0 then 'PUBLIC' else pg_get_userbyid(roleid) end) from unnest(p.polroles) roleid),
 'usingHash',md5(pg_get_expr(p.polqual,p.polrelid)),'checkHash',md5(pg_get_expr(p.polwithcheck,p.polrelid)))
 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','storage')
 union all
 select 'trigger',format('%I.%I.%I',n.nspname,c.relname,t.tgname),
 jsonb_build_object('enabled',t.tgenabled,'definitionHash',md5(pg_get_triggerdef(t.oid,true)))
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 join pg_proc p on p.oid=t.tgfoid join pg_namespace fn on fn.oid=p.pronamespace
 where not t.tgisinternal and (n.nspname='public' or (n.nspname in ('auth','storage') and fn.nspname='public'))
 union all
 select 'enum',format('%I.%I',n.nspname,t.typname),jsonb_build_object('labels',jsonb_agg(e.enumlabel order by e.enumsortorder))
 from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid
 where n.nspname='public' group by n.nspname,t.typname
 union all
 select 'sequence',format('%I.%I',r.nspname,r.relname),
 jsonb_build_object('type',format_type(s.seqtypid,null),'start',s.seqstart,'increment',s.seqincrement,
 'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle,
 'ownedBy',(select format('%I.%I.%I',n.nspname,c.relname,a.attname) from pg_depend d
 join pg_class c on c.oid=d.refobjid join pg_namespace n on n.oid=c.relnamespace
 join pg_attribute a on a.attrelid=c.oid and a.attnum=d.refobjsubid
 where d.classid='pg_class'::regclass and d.objid=r.oid and d.deptype in ('a','i') limit 1))
 from relations r join pg_sequence s on s.seqrelid=r.oid
 union all
 select 'default_acl',format('%s.%s.%s',pg_get_userbyid(d.defaclrole),coalesce(n.nspname,'*'),d.defaclobjtype),
 jsonb_build_object('acl',(select jsonb_agg(v::text order by v::text) from unnest(d.defaclacl) v))
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' or d.defaclnamespace=0
 union all
 select 'schema','public',jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
 'acl',(select jsonb_agg(v::text order by v::text) from unnest(n.nspacl) v)) from pg_namespace n where n.nspname='public'
)
select jsonb_build_object('formatVersion',1,'capturedAt',current_timestamp,
 'serverVersion',current_setting('server_version'),
 'scope','public objects; public/storage RLS; custom auth/storage triggers; no row data',
 'objects',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'key',key,'signature',signature) order by kind,key),'[]'::jsonb)) as inventory
from objects;
