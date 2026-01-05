import React, { useState } from 'react';

const ProhibitedItemsModal = ({ isOpen, onClose, onConfirm }) => {
    const [accepted, setAccepted] = useState(false);

    if (!isOpen) return null;

    const items = [
        { icon: '🔫', label: 'Arma de fuego' }, // Using emojis as placeholders for custom icons if not available, or material symbols
        { icon: '☠️', label: 'Sustancias ilícitas' },
        { icon: '💵', label: 'Efectivo' },
        { icon: '☣️', label: 'Basura Tóxica' },
        { icon: '🧱', label: 'Lingotes' },
        { icon: '🎆', label: 'Fuegos artificiales' },
        { icon: '🦟', label: 'Insecticidas' },
    ];

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="bg-white rounded-[32px] w-full max-w-md p-6 animate-in slide-in-from-bottom duration-300">
                <div className="w-10 h-1.5 bg-gray-200 rounded-full mx-auto mb-6"></div>

                <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Artículos prohibidos</h2>
                <p className="text-gray-500 text-center mb-8">en nuestros envíos</p>

                <div className="grid grid-cols-4 gap-4 mb-8">
                    {items.map((item, index) => (
                        <div key={index} className="flex flex-col items-center gap-2 text-center">
                            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-2xl text-emerald-600">
                                {item.icon.length > 2 ? <span className="material-symbols-outlined">{item.icon}</span> : item.icon}
                            </div>
                            <span className="text-[10px] font-bold text-gray-700 leading-tight">{item.label}</span>
                        </div>
                    ))}
                </div>

                <div className="flex items-start gap-3 mb-6 p-2">
                    <input
                        type="checkbox"
                        id="terms"
                        className="w-5 h-5 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500 mt-0.5"
                        checked={accepted}
                        onChange={(e) => setAccepted(e.target.checked)}
                    />
                    <label htmlFor="terms" className="text-xs text-gray-500 leading-relaxed">
                        Confirmo que he leído y aceptado los <span className="text-emerald-500 font-bold">Términos y Condiciones</span> y <span className="text-emerald-500 font-bold">Políticas de privacidad</span>
                    </label>
                </div>

                <button
                    onClick={onConfirm}
                    disabled={!accepted}
                    className="w-full bg-gray-300 disabled:bg-gray-200 disabled:text-gray-400 text-gray-800 disabled:cursor-not-allowed hover:bg-emerald-500 hover:text-white transition-all py-4 rounded-2xl font-bold text-lg"
                >
                    Aceptar
                </button>
            </div>
        </div>
    );
};

export default ProhibitedItemsModal;
