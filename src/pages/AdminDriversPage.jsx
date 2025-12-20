
import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

// Helper to format date
const formatDate = (dateString) => {
    if (!dateString) return '--';
    return new Date(dateString).toISOString().split('T')[0];
};

const AdminDriversPage = () => {
    const [drivers, setDrivers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'active', 'suspended'

    // Modal States
    const [showObjModal, setShowObjModal] = useState(false); // Action Modal
    const [selectedDriver, setSelectedDriver] = useState(null);
    const [actionType, setActionType] = useState('pago'); // 'pago', 'pago_activar', 'activar', 'desactivar', 'eliminar'

    const [showRegisterModal, setShowRegisterModal] = useState(false);
    const [newDriver, setNewDriver] = useState({
        full_name: '',
        phone: '',
        vehicle_type: 'Carro',
        vehicle_brand: '',
        vehicle_model: '',
        vehicle_color: '',
        license_plate: '',
        email: '',
        password: '',
        avatar_url: '',
        payment_qr_url: ''
    });

    const [message, setMessage] = useState(null);

    // Fetch Drivers
    const fetchDrivers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('role', 'driver')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setDrivers(data || []);
        } catch (error) {
            console.error('Error fetching drivers:', error);
            setMessage({ type: 'error', text: 'Failed to load drivers.' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDrivers();
    }, []);

    // Filter Logic
    const filteredDrivers = drivers.filter(driver => {
        const matchesSearch = driver.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            driver.license_plate?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all'
            ? true
            : filterStatus === 'active'
                ? (driver.subscription_status === 'active' || !driver.subscription_status)
                : driver.subscription_status === 'suspended';

        return matchesSearch && matchesStatus;
    });

    // Helper Action
    const executeAction = async () => {
        if (!selectedDriver) return;
        setLoading(true);
        setMessage(null);

        try {
            let updates = {};
            const today = new Date().toISOString();

            if (actionType === 'pago') {
                updates = { last_payment_date: today };
            } else if (actionType === 'pago_activar') {
                updates = { last_payment_date: today, subscription_status: 'active' };
            } else if (actionType === 'activar') {
                updates = { subscription_status: 'active' };
            } else if (actionType === 'desactivar') {
                updates = { subscription_status: 'suspended' };
            } else if (actionType === 'eliminar') {
                // Delete
                const { error } = await supabase.from('profiles').delete().eq('id', selectedDriver.id);
                if (error) throw error;
                setMessage({ type: 'success', text: 'Driver deleted successfully.' });
                setShowObjModal(false);
                fetchDrivers();
                return;
            }

            if (Object.keys(updates).length > 0) {
                const { error } = await supabase.from('profiles').update(updates).eq('id', selectedDriver.id);
                if (error) throw error;
                setMessage({ type: 'success', text: 'Driver updated successfully.' });
            }

            setShowObjModal(false);
            fetchDrivers();

        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setLoading(false);
        }
    };

    // Handle Registration (Simulation of Auth + DB)
    const handleRegister = async () => {
        setLoading(true);
        try {
            const fakeUUID = crypto.randomUUID();

            // Insert Profile
            const { error } = await supabase.from('profiles').insert([{
                id: fakeUUID, // Ideally this comes from auth.signUp()
                full_name: newDriver.full_name,
                phone: newDriver.phone,
                role: 'driver',
                status: 'offline',
                vehicle_type: newDriver.vehicle_type,
                vehicle_brand: newDriver.vehicle_brand,
                vehicle_model: newDriver.vehicle_model,
                vehicle_color: newDriver.vehicle_color,
                license_plate: newDriver.license_plate,
                avatar_url: processGoogleDriveLink(newDriver.avatar_url),
                payment_qr_url: processGoogleDriveLink(newDriver.payment_qr_url),
                subscription_status: 'active',
                last_payment_date: new Date().toISOString()
            }]);

            if (error) throw error;

            setMessage({ type: 'success', text: `Driver registered!(Fake UUID: ${fakeUUID})` });
            setShowRegisterModal(false);
            fetchDrivers();
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setLoading(false);
        }
    };

    const processGoogleDriveLink = (url) => {
        if (!url) return '';
        if (url.includes('drive.google.com') && url.includes('/file/d/')) {
            const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) return `https://drive.google.com/uc?export=view&id=${match[1]}`;
        }
        return url;
    };

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-3 rounded-2xl shadow-lg shadow-violet-600/20">
                        <span className="material-symbols-outlined text-white text-2xl">admin_panel_settings</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-white">Administración Higo</h1>
                        <p className="text-gray-400 text-sm font-medium">Gestión de Flota</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowRegisterModal(true)}
                    className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg hover:shadow-violet-600/30 transition-all active:scale-95"
                >
                    <span className="material-symbols-outlined">add</span>
                    Registrar Nuevo Higo Driver
                </button>
            </div>

            {/* Alert / Warning */}
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 mb-8 flex items-center gap-3 text-orange-400">
                <span className="material-symbols-outlined">warning</span>
                <span className="font-bold">Corte Automático Activo</span>
            </div>

            {/* Filters + Action Bar */}
            <div className="bg-[#1A1F2E] p-6 rounded-[24px] shadow-2xl border border-white/5 mb-6">
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
                    <div className="relative w-full md:w-96 group">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-violet-500 transition-colors material-symbols-outlined">search</span>
                        <input
                            type="text"
                            placeholder="Buscar por nombre o placa..."
                            className="w-full pl-12 pr-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500/50 focus:ring-4 focus:ring-violet-500/10 text-white placeholder:text-gray-600 transition-all"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2 bg-[#0F1014] p-1.5 rounded-xl border border-white/5">
                        {['all', 'active', 'suspended'].map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${filterStatus === status
                                    ? 'bg-[#2C3345] text-white shadow-lg'
                                    : 'text-gray-500 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {status === 'all' ? 'Todos' : status === 'active' ? 'Activos' : 'Suspendidos'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Message Toast */}
            {message && (
                <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                    <span className="material-symbols-outlined">{message.type === 'success' ? 'check_circle' : 'error'}</span>
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            {/* Drivers List */}
            <div className="space-y-4">
                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : filteredDrivers.map(driver => (
                    <div key={driver.id} className="bg-[#1A1F2E] p-4 md:p-6 rounded-[24px] shadow-sm border border-white/5 flex flex-col md:flex-row items-center gap-6 group hover:border-violet-500/30 transition-all relative overflow-hidden">

                        {/* Status Stripe */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${driver.subscription_status === 'suspended' ? 'bg-red-500' : 'bg-emerald-500'}`}></div>

                        {/* Driver Info */}
                        <div className="flex items-center gap-4 flex-1 pl-4">
                            <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-br from-violet-500 to-fuchsia-600">
                                <div
                                    className="w-full h-full rounded-full bg-[#1A1F2E] bg-center bg-cover border-2 border-[#1A1F2E]"
                                    style={{ backgroundImage: `url('${driver.avatar_url || "https://picsum.photos/200"}')` }}
                                ></div>
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-lg">{driver.full_name}</h3>
                                <div className="text-sm text-gray-400 space-y-0.5 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[14px]">phone</span>
                                    {driver.phone}
                                </div>
                            </div>
                        </div>

                        {/* Vehicle */}
                        <div className="w-full md:w-48 bg-[#0F1014] p-3 rounded-xl border border-white/5">
                            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Vehículo ({driver.vehicle_color || '?'})</p>
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-white">{driver.vehicle_brand || driver.vehicle_type}</span>
                                <span className="bg-[#1A1F2E] px-2 py-0.5 rounded text-xs font-mono text-violet-400 border border-violet-500/20">{driver.license_plate}</span>
                            </div>
                        </div>

                        {/* Status */}
                        <div className="w-full md:w-32 text-center md:text-left">
                            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Estado</p>
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${driver.subscription_status === 'suspended'
                                ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                                : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${driver.subscription_status === 'suspended' ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                                {driver.subscription_status === 'suspended' ? 'Suspendido' : 'Activo'}
                            </span>
                        </div>

                        {/* Last Payment */}
                        <div className="w-full md:w-32  text-center md:text-left">
                            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Ult. Pago</p>
                            <p className="font-mono text-sm text-gray-300">{formatDate(driver.last_payment_date)}</p>
                        </div>

                        {/* Actions Button */}
                        <div className="w-full md:w-auto flex justify-end">
                            <button
                                onClick={() => { setSelectedDriver(driver); setShowObjModal(true); }}
                                className="w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
                            >
                                <span className="material-symbols-outlined">more_vert</span>
                            </button>
                        </div>
                    </div>
                ))}

                {filteredDrivers.length === 0 && !loading && (
                    <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined text-gray-500 text-3xl">search_off</span>
                        </div>
                        <p className="text-gray-400 font-medium">No se encontraron conductores.</p>
                    </div>
                )}
            </div>

            {/* ACTION MODAL - DARK */}
            {showObjModal && selectedDriver && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="bg-[#1A1F2E] w-full max-w-sm rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 border border-white/10 ring-1 ring-white/5">
                        <div className="p-6 bg-gradient-to-br from-violet-600 to-fuchsia-600 relative">
                            <button
                                onClick={() => setShowObjModal(false)}
                                className="absolute top-4 right-4 w-8 h-8 bg-black/20 hover:bg-black/30 rounded-full flex items-center justify-center text-white transition-colors"
                            >
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                            <h3 className="font-bold text-white text-lg">Acciones</h3>
                            <p className="text-violet-100 text-sm opacity-90">{selectedDriver.full_name}</p>
                        </div>

                        <div className="p-4 space-y-2">
                            {[
                                { id: 'pago', label: 'Solo Pago', icon: 'payments', desc: 'Registrar pago de flota' },
                                { id: 'pago_activar', label: 'Pago + Activar', icon: 'bolt', desc: 'Registrar pago y reactivar' },
                                { id: 'activar', label: 'Activar', icon: 'check_circle', desc: 'Activar manualmente' },
                                { id: 'desactivar', label: 'Desactivar', icon: 'block', desc: 'Suspender manualmente' },
                                { id: 'eliminar', label: 'Eliminar', icon: 'delete', desc: 'Borrar permanentemente' }
                            ].map((opt) => (
                                <button
                                    key={opt.id}
                                    onClick={() => setActionType(opt.id)}
                                    className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all border ${actionType === opt.id
                                        ? 'bg-violet-600/10 border-violet-500/50'
                                        : 'bg-[#0F1014] border-transparent hover:bg-white/5'
                                        }`}
                                >
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${opt.id === 'eliminar' ? 'bg-red-500/20 text-red-500' :
                                            actionType === opt.id ? 'bg-violet-600 text-white' : 'bg-[#1A1F2E] text-gray-400 border border-white/5'
                                        }`}>
                                        <span className="material-symbols-outlined text-[20px]">{opt.icon}</span>
                                    </div>
                                    <div className="text-left flex-1">
                                        <p className={`font-bold text-sm ${actionType === opt.id ? 'text-violet-400' : 'text-gray-200'}`}>{opt.label}</p>
                                        <p className="text-xs text-gray-500">{opt.desc}</p>
                                    </div>
                                    {actionType === opt.id && (
                                        <span className="material-symbols-outlined text-violet-500 text-sm">radio_button_checked</span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <div className="p-4 border-t border-white/5 bg-[#151925]">
                            <button
                                onClick={executeAction}
                                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-violet-600/20 flex gap-2 justify-center items-center transition-all active:scale-[0.98]"
                            >
                                <span className="material-symbols-outlined">play_arrow</span>
                                Ejecutar Acción
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* REGISTER MODAL - DARK */}
            {showRegisterModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
                    <div className="bg-[#1A1F2E] w-full max-w-md rounded-[32px] shadow-2xl my-8 animate-in slide-in-from-bottom-4 border border-white/10">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#151925] rounded-t-[32px]">
                            <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                                <span className="material-symbols-outlined text-violet-500">person_add</span>
                                Nuevo Conductor
                            </h2>
                            <button onClick={() => setShowRegisterModal(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all">
                                <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                        </div>

                        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                            <div>
                                <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Nombre Completo</label>
                                <input
                                    className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white outline-none focus:border-violet-500 transition-colors"
                                    placeholder="Ej. Pedro Pérez"
                                    value={newDriver.full_name}
                                    onChange={(e) => setNewDriver({ ...newDriver, full_name: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Teléfono</label>
                                    <input
                                        className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white outline-none focus:border-violet-500 transition-colors"
                                        placeholder="0412-..."
                                        value={newDriver.phone}
                                        onChange={(e) => setNewDriver({ ...newDriver, phone: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Vehículo</label>
                                    <div className="relative">
                                        <select
                                            className="w-full p-3.5 bg-[#0F1014] border border-white/10 rounded-xl text-white outline-none focus:border-violet-500 transition-colors appearance-none"
                                            value={newDriver.vehicle_type}
                                            onChange={(e) => setNewDriver({ ...newDriver, vehicle_type: e.target.value })}
                                        >
                                            <option value="Moto">Moto</option>
                                            <option value="Carro">Carro</option>
                                            <option value="Camioneta">Camioneta</option>
                                        </select>
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-500 pointer-events-none">expand_more</span>
                                    </div>
                                </div>
                            </div>

                            {/* Vehicle Details */}
                            <div className="p-4 rounded-xl bg-[#0F1014] border border-white/5 space-y-4">
                                <p className="text-xs font-bold text-violet-400 uppercase tracking-wider mb-2">Detalles del Vehículo</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold mb-1 text-gray-500 uppercase">Marca</label>
                                        <input
                                            className="w-full p-3 bg-[#1A1F2E] border border-white/10 rounded-lg text-white text-sm outline-none focus:border-violet-500"
                                            placeholder="Toyota"
                                            value={newDriver.vehicle_brand}
                                            onChange={(e) => setNewDriver({ ...newDriver, vehicle_brand: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold mb-1 text-gray-500 uppercase">Modelo</label>
                                        <input
                                            className="w-full p-3 bg-[#1A1F2E] border border-white/10 rounded-lg text-white text-sm outline-none focus:border-violet-500"
                                            placeholder="Corolla"
                                            value={newDriver.vehicle_model}
                                            onChange={(e) => setNewDriver({ ...newDriver, vehicle_model: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold mb-1 text-gray-500 uppercase">Color</label>
                                        <input
                                            className="w-full p-3 bg-[#1A1F2E] border border-white/10 rounded-lg text-white text-sm outline-none focus:border-violet-500"
                                            placeholder="Gris"
                                            value={newDriver.vehicle_color}
                                            onChange={(e) => setNewDriver({ ...newDriver, vehicle_color: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold mb-1 text-gray-500 uppercase">Placa</label>
                                        <input
                                            className="w-full p-3 bg-[#1A1F2E] border border-white/10 rounded-lg text-white text-sm outline-none focus:border-violet-500"
                                            placeholder="AA000AA"
                                            value={newDriver.license_plate}
                                            onChange={(e) => setNewDriver({ ...newDriver, license_plate: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-dashed border-white/10 my-4"></div>

                            {/* Credentials */}
                            <div>
                                <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Correo (Login)</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-500">mail</span>
                                    <input
                                        className="w-full pl-10 pr-3 py-3 bg-[#0F1014] border border-white/10 rounded-xl text-white outline-none focus:border-violet-500 transition-colors"
                                        placeholder="usuario@higo.com"
                                        value={newDriver.email}
                                        onChange={(e) => setNewDriver({ ...newDriver, email: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold mb-1.5 text-gray-400 uppercase tracking-wider">Contraseña</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-500">key</span>
                                    <input
                                        type="password"
                                        className="w-full pl-10 pr-3 py-3 bg-[#0F1014] border border-white/10 rounded-xl text-white outline-none focus:border-violet-500 transition-colors"
                                        placeholder="******"
                                        value={newDriver.password}
                                        onChange={(e) => setNewDriver({ ...newDriver, password: e.target.value })}
                                    />
                                </div>
                            </div>

                        </div>

                        <div className="p-6 border-t border-white/5 bg-[#151925] rounded-b-[32px]">
                            <button
                                onClick={handleRegister}
                                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-violet-600/20 flex gap-2 justify-center items-center transition-all active:scale-[0.98]"
                            >
                                <span className="material-symbols-outlined">check_circle</span>
                                Crear Higo Driver
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminDriversPage;

