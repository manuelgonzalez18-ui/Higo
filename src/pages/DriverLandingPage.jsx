import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';


const DriverLandingPage = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        phone: '',
        city: 'Higuerote',
        vehicle_type: '',
        id_number: ''
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { error } = await supabase
                .from('driver_applications')
                .insert([formData]);

            if (error) throw error;
            setSubmitted(true);
        } catch (err) {
            console.error('Error submitting application:', err);
            alert('Error al enviar la solicitud. Por favor intenta de nuevo.');
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mb-6 animate-bounce">
                    <span className="material-symbols-outlined text-green-500 text-4xl">check_circle</span>
                </div>
                <h1 className="text-3xl font-bold text-white mb-4">¡Solicitud Enviada!</h1>
                <p className="text-gray-400 max-w-md mb-8">
                    Gracias por tu interés en ser un Higo Driver. Hemos recibido tus datos y nuestro equipo se pondrá en contacto contigo muy pronto.
                </p>
                <button
                    onClick={() => navigate('/')}
                    className="bg-white text-black px-8 py-3 rounded-xl font-bold transition-transform active:scale-95 shadow-xl shadow-white/5"
                >
                    Volver al Inicio
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0F1014] font-sans text-white overflow-x-hidden">
            {/* Nav */}
            <nav className="p-6 flex justify-between items-center max-w-7xl mx-auto relative z-10">
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
                    {/* Logo removed temporarily */}
                </div>
                <button
                    onClick={() => navigate('/auth')}
                    className="text-sm font-bold bg-[#1A1F2E] px-5 py-2.5 rounded-xl border border-white/5 hover:border-white/20 transition-all"
                >
                    Iniciar Sesión
                </button>
            </nav>

            {/* Hero Section */}
            <main className="max-w-7xl mx-auto px-6 pt-12 pb-24 grid lg:grid-cols-2 gap-16 items-center">
                <div className="space-y-8">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-gray-400 animate-fade-in">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        Estamos aceptando conductores en Higuerote
                    </div>

                    <h1 className="text-5xl md:text-7xl font-black leading-tight tracking-tight">
                        Sé tu propio <br />
                        <span className="bg-gradient-to-r from-white via-gray-300 to-gray-500 bg-clip-text text-transparent">Jefe con Higo.</span>
                    </h1>

                    <p className="text-xl text-gray-400 leading-relaxed max-w-lg">
                        Únete a la plataforma de movilidad más avanzada de la región. Gana dinero en tus propios términos, con tecnología de punta y seguridad garantizada.
                    </p>

                    <div className="grid grid-cols-2 gap-6 pt-4">
                        <div className="p-4 bg-[#16181D] rounded-2xl border border-white/5">
                            <h3 className="text-2xl font-bold mb-1">90%</h3>
                            <p className="text-xs text-gray-500">De ganancia neta por viaje</p>
                        </div>
                        <div className="p-4 bg-[#16181D] rounded-2xl border border-white/5">
                            <h3 className="text-2xl font-bold mb-1">24/7</h3>
                            <p className="text-xs text-gray-500">Soporte y seguridad activa</p>
                        </div>
                    </div>
                </div>

                {/* Registration Form Card */}
                <div className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-white/20 to-transparent rounded-[32px] blur-2xl opacity-20 group-hover:opacity-30 transition-opacity"></div>

                    <div className="relative bg-[#16181D] border border-white/10 p-8 md:p-10 rounded-[32px] shadow-2xl">
                        <h2 className="text-2xl font-bold mb-2">Formulario de registro</h2>
                        <p className="text-gray-500 text-sm mb-8">Completa tus datos para iniciar el proceso.</p>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="grid md:grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Nombre Completo *</label>
                                    <input
                                        type="text" required name="full_name" placeholder="Ej. Juan Pérez"
                                        className="w-full bg-[#0F1014] border border-white/5 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/20 transition-all placeholder:text-gray-700"
                                        value={formData.full_name} onChange={handleChange}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Correo Electrónico *</label>
                                    <input
                                        type="email" required name="email" placeholder="juan@ejemplo.com"
                                        className="w-full bg-[#0F1014] border border-white/5 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/20 transition-all placeholder:text-gray-700"
                                        value={formData.email} onChange={handleChange}
                                    />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Número de Teléfono *</label>
                                    <input
                                        type="tel" required name="phone" placeholder="0412-0000000"
                                        className="w-full bg-[#0F1014] border border-white/5 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/20 transition-all placeholder:text-gray-700"
                                        value={formData.phone} onChange={handleChange}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Ciudad *</label>
                                    <input
                                        type="text" required name="city" placeholder="Ej. Higuerote"
                                        className="w-full bg-[#0F1014] border border-white/5 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/20 transition-all placeholder:text-gray-700"
                                        value={formData.city} onChange={handleChange}
                                    />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Tipo de Vehículo *</label>
                                    <select
                                        required name="vehicle_type"
                                        className="w-full bg-[#0F1014] border border-white/5 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/20 transition-all appearance-none cursor-pointer"
                                        value={formData.vehicle_type} onChange={handleChange}
                                    >
                                        <option value="" disabled>Seleccionar tipo</option>
                                        <option value="moto">Moto</option>
                                        <option value="standard">Carro</option>
                                        <option value="van">Camioneta / Van</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Número de Cédula *</label>
                                    <input
                                        type="text" required name="id_number" placeholder="Ej. 12345678"
                                        className="w-full bg-[#0F1014] border border-white/5 rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-white/20 transition-all placeholder:text-gray-700"
                                        value={formData.id_number} onChange={handleChange}
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-white text-black font-black py-4 rounded-2xl shadow-xl shadow-white/5 flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50 mt-4 group"
                            >
                                {loading ? (
                                    <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                                ) : (
                                    <>
                                        REGISTRARME AHORA
                                        <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
                                    </>
                                )}
                            </button>

                            <p className="text-[10px] text-center text-gray-500 pt-2 px-10">
                                Al registrarte, aceptas nuestros términos de servicio y política de privacidad de Higo App.
                            </p>
                        </form>
                    </div>
                </div>
            </main>

            {/* Background Decorations */}
            <div className="fixed top-0 left-0 w-full h-screen pointer-events-none -z-10">
                <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-500/10 blur-[120px] rounded-full"></div>
                <div className="absolute bottom-[-5%] left-[-5%] w-[40%] h-[40%] bg-gray-500/5 blur-[100px] rounded-full"></div>
            </div>
        </div>
    );
};

export default DriverLandingPage;
