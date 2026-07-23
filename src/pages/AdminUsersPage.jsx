import React, { useEffect, useMemo, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { supabase } from '../services/supabase';
import {
    changeProfileRole,
    getAdminContext,
    listAdminStaff,
    listAuditLog,
    setAdminSecuritySettings,
    updateAdminStaffRole,
} from '../services/adminApi';
import { toast } from '../components/Toast';

const STAFF_ROLES = [
    ['super_admin', 'Super admin'],
    ['operations', 'Operaciones'],
    ['support', 'Soporte'],
    ['finance', 'Finanzas'],
    ['viewer', 'Solo lectura'],
];
const PROFILE_ROLES = ['passenger', 'driver', 'merchant', 'admin'];

const formatDate = value => value ? new Date(value).toLocaleString('es-VE') : '—';

export default function AdminUsersPage() {
    const [tab, setTab] = useState('users');
    const [context, setContext] = useState(null);
    const [users, setUsers] = useState([]);
    const [staff, setStaff] = useState([]);
    const [audit, setAudit] = useState([]);
    const [query, setQuery] = useState('');
    const [role, setRole] = useState('all');
    const [loading, setLoading] = useState(true);
    const [requireMfa, setRequireMfa] = useState(false);
    const [sessionMinutes, setSessionMinutes] = useState(60);

    const superAdmin = context?.staff_role === 'super_admin';

    const loadContext = async () => {
        const ctx = await getAdminContext();
        setContext(ctx);
        setRequireMfa(!!ctx?.require_mfa);
    };

    const loadUsers = async () => {
        setLoading(true);
        try {
            let q = supabase.from('profiles')
                .select('id,full_name,phone,email,role,created_at,archived_at')
                .order('created_at', { ascending: false })
                .limit(100);
            if (role !== 'all') q = q.eq('role', role);
            const term = query.trim();
            if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
            const { data, error } = await q;
            if (error) throw error;
            setUsers(data || []);
        } catch (err) { toast.error(err.message); } finally { setLoading(false); }
    };

    const loadStaff = async () => {
        setLoading(true);
        try { setStaff(await listAdminStaff() || []); }
        catch (err) { toast.error(err.message); }
        finally { setLoading(false); }
    };

    const loadAudit = async () => {
        setLoading(true);
        try { setAudit(await listAuditLog(150) || []); }
        catch (err) { toast.error(err.message); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadContext().catch(err => toast.error(err.message)); }, []);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (tab === 'users') loadUsers();
            if (tab === 'staff') loadStaff();
            if (tab === 'audit') loadAudit();
        }, tab === 'users' ? 250 : 0);
        return () => clearTimeout(timer);
    }, [tab, query, role]); // eslint-disable-line react-hooks/exhaustive-deps

    const updateProfileRole = async (user, nextRole) => {
        if (!superAdmin) return toast.error('Solo un super admin puede cambiar roles de cuenta.');
        if (!confirm(`Cambiar a ${user.full_name || user.id} al rol ${nextRole}?`)) return;
        try { await changeProfileRole(user.id, nextRole); toast.success('Rol actualizado y auditado.'); loadUsers(); loadStaff(); }
        catch (err) { toast.error(err.message); }
    };

    const updateStaff = async (item, nextRole, active = item.active) => {
        if (!superAdmin) return toast.error('Solo un super admin puede administrar permisos.');
        try { await updateAdminStaffRole({ userId: item.user_id, staffRole: nextRole, active }); toast.success('Permisos actualizados.'); loadStaff(); }
        catch (err) { toast.error(err.message); }
    };

    const saveSecurity = async () => {
        if (!superAdmin) return toast.error('Solo un super admin puede cambiar la política de seguridad.');
        if (requireMfa && !confirm('Antes de exigir MFA, todos los administradores deben haber configurado su autenticador. ¿Activar igualmente?')) return;
        try { await setAdminSecuritySettings({ requireMfa, sessionMinutes: Number(sessionMinutes) }); toast.success('Política de seguridad actualizada.'); await loadContext(); }
        catch (err) { toast.error(err.message); }
    };

    const tabs = useMemo(() => [
        ['users', 'Usuarios'],
        ['staff', 'Staff y permisos'],
        ['security', 'Seguridad'],
        ['audit', 'Auditoría'],
    ], []);

    return (
        <div className="min-h-screen bg-[#0F1014] text-white p-4 md:p-8">
            <AdminNav />
            <div className="mb-6"><h1 className="text-2xl font-black">Usuarios y administración</h1><p className="text-sm text-gray-400 mt-1">Roles operativos, seguridad y trazabilidad de cambios.</p></div>

            <div className="flex gap-2 border-b border-white/5 mb-6 overflow-x-auto">{tabs.map(([id,label]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap ${tab === id ? 'border-violet-500 text-white' : 'border-transparent text-gray-500'}`}>{label}</button>)}</div>

            {tab === 'users' && <>
                <div className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 mb-5 flex flex-col md:flex-row gap-3">
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, teléfono o correo…" className="flex-1 p-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500" />
                    <select value={role} onChange={e => setRole(e.target.value)} className="p-3 bg-[#0F1014] border border-white/10 rounded-xl"><option value="all">Todos los roles</option>{PROFILE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>
                </div>
                {loading ? <Spinner /> : <div className="space-y-3">{users.map(user => <article key={user.id} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center gap-4"><div className="flex-1 min-w-0"><p className="font-bold truncate">{user.full_name || 'Sin nombre'}</p><p className="text-xs text-gray-400 truncate">{user.email || 'Sin correo'} · {user.phone || 'Sin teléfono'}</p><p className="text-[10px] text-gray-600 mt-1">Alta: {formatDate(user.created_at)}</p></div><span className="px-3 py-1 rounded-full text-xs font-bold bg-white/5 text-gray-300">{user.role}</span>{superAdmin && <select value={user.role === 'user' ? 'passenger' : user.role} onChange={e => updateProfileRole(user, e.target.value)} className="p-2 bg-[#0F1014] border border-white/10 rounded-lg text-xs">{PROFILE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select>}</article>)}{!users.length && <Empty text="No se encontraron usuarios." />}</div>}
            </>}

            {tab === 'staff' && <>
                <div className="mb-5 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-sm text-blue-200">Los permisos administrativos ya no dependen de un único rol genérico. Solo el super admin puede modificar esta tabla.</div>
                {loading ? <Spinner /> : <div className="space-y-3">{staff.map(item => <article key={item.user_id} className="bg-[#1A1F2E] border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-4"><div className="flex-1"><p className="font-bold">{item.full_name || item.user_id}</p><p className="text-xs text-gray-500">{item.phone || 'Sin teléfono'}</p></div><select disabled={!superAdmin} value={item.staff_role} onChange={e => updateStaff(item, e.target.value)} className="p-3 bg-[#0F1014] border border-white/10 rounded-xl disabled:opacity-60">{STAFF_ROLES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!superAdmin} checked={item.active} onChange={e => updateStaff(item, item.staff_role, e.target.checked)} /> Activo</label></article>)}</div>}
            </>}

            {tab === 'security' && <div className="max-w-2xl bg-[#1A1F2E] border border-white/5 rounded-2xl p-6 space-y-5">
                <div><h2 className="font-black text-lg">Política del panel</h2><p className="text-sm text-gray-400 mt-1">MFA se entrega desactivado para no bloquear cuentas existentes. Debe activarse después de enrolar a todo el staff.</p></div>
                <label className="flex items-start gap-3 p-4 bg-[#0F1014] rounded-xl border border-white/10"><input type="checkbox" disabled={!superAdmin} checked={requireMfa} onChange={e => setRequireMfa(e.target.checked)} className="mt-1" /><div><p className="font-bold">Exigir autenticación de dos pasos</p><p className="text-xs text-gray-500 mt-1">Las acciones críticas también verifican AAL2 del lado de la base de datos.</p></div></label>
                <div><label className="text-xs uppercase text-gray-500 font-bold">Duración objetivo de sesión administrativa</label><input type="number" min="15" max="720" disabled={!superAdmin} value={sessionMinutes} onChange={e => setSessionMinutes(e.target.value)} className="mt-1 w-full p-3 bg-[#0F1014] border border-white/10 rounded-xl" /><p className="text-[10px] text-gray-600 mt-1">La expiración completa requiere aplicar este valor también a la configuración JWT del proyecto Supabase.</p></div>
                <button disabled={!superAdmin} onClick={saveSecurity} className="px-5 py-3 rounded-xl bg-violet-600 disabled:opacity-40 font-bold">Guardar política</button>
            </div>}

            {tab === 'audit' && <>{loading ? <Spinner /> : <div className="overflow-x-auto bg-[#1A1F2E] border border-white/5 rounded-2xl"><table className="w-full text-sm"><thead className="text-left text-gray-500 text-xs uppercase"><tr><th className="p-4">Fecha</th><th className="p-4">Acción</th><th className="p-4">Entidad</th><th className="p-4">Actor</th><th className="p-4">Motivo</th></tr></thead><tbody>{audit.map(row => <tr key={row.id} className="border-t border-white/5"><td className="p-4 whitespace-nowrap text-gray-400">{formatDate(row.created_at)}</td><td className="p-4 font-mono text-violet-300">{row.action}</td><td className="p-4">{row.entity_type}<span className="block text-[10px] text-gray-600">{row.entity_id}</span></td><td className="p-4 font-mono text-xs text-gray-400">{row.actor_id?.slice(0,8) || 'sistema'}</td><td className="p-4 text-gray-400">{row.reason || '—'}</td></tr>)}</tbody></table></div>}</>}
        </div>
    );
}

const Spinner = () => <div className="py-24 flex justify-center"><div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
const Empty = ({ text }) => <div className="py-20 text-center bg-[#1A1F2E] border border-dashed border-white/10 rounded-2xl text-gray-500">{text}</div>;
