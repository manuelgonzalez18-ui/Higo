import React from 'react';
import { openLegalLink } from '../utils/openLegalLink';
import { TERMS_URL, PRIVACY_URL } from '../constants/legalUrls';

// Texto legal genérico para puntos de conversión (registro, primer
// envío, etc.). Renderiza el copy aceptado por Legal con dos links
// clickables que abren los documentos con @capacitor/browser.
//
// Props:
//   actionLabel: palabra que precede el disclaimer
//                ("Continuar", "Crear Cuenta", "Confirmar Envío", etc.)
//   className:   override opcional de wrapper styles

const LegalConsentText = ({ actionLabel = 'Continuar', className = '' }) => (
    <p className={`text-center text-xs text-gray-500 leading-relaxed px-2 ${className}`}>
        Al presionar <strong className="text-gray-400">{actionLabel}</strong>, confirmas
        que aceptas nuestros{' '}
        <button
            type="button"
            onClick={(e) => { e.preventDefault(); openLegalLink(TERMS_URL); }}
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
        >
            Términos y Condiciones
        </button>{' '}
        y que has leído nuestra{' '}
        <button
            type="button"
            onClick={(e) => { e.preventDefault(); openLegalLink(PRIVACY_URL); }}
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
        >
            Política de Privacidad
        </button>.
    </p>
);

export default LegalConsentText;
