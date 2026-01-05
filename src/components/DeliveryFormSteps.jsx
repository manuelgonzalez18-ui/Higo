import React, { useState } from 'react';

const DeliveryFormSteps = ({ onSubmit, onCancel }) => {
    const [step, setStep] = useState(1);
    const [data, setData] = useState({
        senderName: '',
        senderPhone: '',
        receiverName: '',
        receiverPhone: '',
        originInstructions: '',
        destInstructions: '',
        payer: 'sender' // 'sender' (Yo) or 'receiver' (Destinatario)
    });

    const handleChange = (field, value) => {
        setData(prev => ({ ...prev, [field]: value }));
    };

    const nextStep = () => setStep(prev => prev + 1);
    const prevStep = () => setStep(prev => prev - 1);

    const handleSubmit = () => {
        onSubmit(data);
    };

    return (
        <div className="fixed inset-0 z-40 bg-[#10141F] flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="p-6 flex items-center gap-4">
                <button onClick={step === 1 ? onCancel : prevStep} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-white">arrow_back</span>
                </button>
                <div className="flex-1">
                    <h2 className="text-xl font-bold text-white">
                        {step === 1 ? 'Datos de Contacto' : step === 2 ? 'Instrucciones' : 'Método de Pago'}
                    </h2>
                    <div className="flex gap-1 mt-1">
                        <div className={`h-1 flex-1 rounded-full ${step >= 1 ? 'bg-emerald-500' : 'bg-gray-700'}`}></div>
                        <div className={`h-1 flex-1 rounded-full ${step >= 2 ? 'bg-emerald-500' : 'bg-gray-700'}`}></div>
                        <div className={`h-1 flex-1 rounded-full ${step >= 3 ? 'bg-emerald-500' : 'bg-gray-700'}`}></div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 pt-0">
                {step === 1 && (
                    <div className="flex flex-col gap-6">
                        <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-white/5">
                            <h3 className="text-emerald-400 text-sm font-bold uppercase mb-4 flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">call_made</span> Quien Envía
                            </h3>
                            <input
                                placeholder="Nombre y Apellido"
                                className="w-full bg-transparent border-b border-gray-700 py-3 text-white focus:border-emerald-500 outline-none mb-4"
                                value={data.senderName}
                                onChange={e => handleChange('senderName', e.target.value)}
                            />
                            <input
                                type="tel"
                                placeholder="Teléfono"
                                className="w-full bg-transparent border-b border-gray-700 py-3 text-white focus:border-emerald-500 outline-none"
                                value={data.senderPhone}
                                onChange={e => handleChange('senderPhone', e.target.value)}
                            />
                        </div>

                        <div className="bg-[#1A1F2E] p-4 rounded-2xl border border-white/5">
                            <h3 className="text-red-400 text-sm font-bold uppercase mb-4 flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">call_received</span> Quien Recibe
                            </h3>
                            <input
                                placeholder="Nombre y Apellido"
                                className="w-full bg-transparent border-b border-gray-700 py-3 text-white focus:border-emerald-500 outline-none mb-4"
                                value={data.receiverName}
                                onChange={e => handleChange('receiverName', e.target.value)}
                            />
                            <input
                                type="tel"
                                placeholder="Teléfono"
                                className="w-full bg-transparent border-b border-gray-700 py-3 text-white focus:border-emerald-500 outline-none"
                                value={data.receiverPhone}
                                onChange={e => handleChange('receiverPhone', e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="flex flex-col gap-6">
                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">Instrucciones en el origen</label>
                            <textarea
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none h-32 resize-none"
                                placeholder="Ej: Entregar en la recepción, preguntar por María..."
                                value={data.originInstructions}
                                onChange={e => handleChange('originInstructions', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-gray-400 text-sm font-bold block mb-2">Instrucciones en el destino</label>
                            <textarea
                                className="w-full bg-[#1A1F2E] rounded-2xl p-4 text-white border border-white/5 focus:border-emerald-500 outline-none h-32 resize-none"
                                placeholder="Ej: Dejar en portería si no responden..."
                                value={data.destInstructions}
                                onChange={e => handleChange('destInstructions', e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="flex flex-col items-center justify-center flex-1 h-full pt-20">
                        <h2 className="text-2xl font-bold text-white mb-10">¿Quién realiza el pago?</h2>

                        <div className="flex flex-col gap-4 w-full max-w-xs">
                            <button
                                onClick={() => handleChange('payer', 'sender')}
                                className={`p-4 rounded-full font-bold text-lg border transition-all ${data.payer === 'sender' ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'bg-transparent border-gray-600 text-gray-400 hover:border-white'}`}
                            >
                                Remitente (Pago al retirar)
                            </button>
                            <button
                                onClick={() => handleChange('payer', 'receiver')}
                                className={`p-4 rounded-full font-bold text-lg border transition-all ${data.payer === 'receiver' ? 'bg-white border-white text-black shadow-lg' : 'bg-transparent border-gray-600 text-gray-400 hover:border-white'}`}
                            >
                                Destinatario (Pago al entregar)
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-6 bg-[#10141F] border-t border-white/5">
                <button
                    onClick={step === 3 ? handleSubmit : nextStep}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-[20px] font-bold text-lg shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
                >
                    {step === 3 ? 'Finalizar' : 'Continuar'}
                </button>
            </div>
        </div>
    );
};

export default DeliveryFormSteps;
