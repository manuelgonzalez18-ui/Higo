// ErrorBoundary.jsx — H2.3 del Anexo B (Hardening de Producción).
//
// Boundary global que envuelve los <Routes>/<Suspense> en App.jsx.
// Captura errores de render + lifecycle de cualquier page y:
//   1. Muestra una UI amable con logo + 2 botones (Recargar / Inicio)
//      en lugar de white screen.
//   2. Reporta el error a public.client_errors via reportError().
//   3. En dev, expone el stack para diagnostico inmediato.
//
// IMPORTANTE: las boundaries NO capturan errores en event handlers
// async (es React design). Para esos, el catch va en el caller.
//
// Esta clase generaliza la que vivía inline en DriverDashboard.jsx —
// DriverDashboard la sigue usando pero ahora importa desde acá.
//
// Props soportadas:
//   - children: el subtree a proteger (obligatorio)
//   - source:   string para etiquetar el error en context (default 'app-root')
//   - fallback: render prop opcional (error, errorInfo) => ReactNode.
//               Si se pasa, reemplaza la UI default. Util para DriverDashboard
//               que quiere mostrar el stack en pantalla.
//   - silent:   si true, no muestra UI, solo loguea y renderiza children.
//               Usar SOLO en dev para debugging puntual.

import React from 'react';
import { reportError } from '../utils/reportError';

const IS_DEV = (typeof import.meta !== 'undefined'
    && import.meta.env?.DEV === true) || false;

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ error, errorInfo });

        // Reportar a public.client_errors. Failsafe — reportError
        // nunca re-throws (ver implementacion del util).
        reportError(error, {
            componentStack: errorInfo?.componentStack?.slice(0, 4000),
            source: this.props.source || 'app-root',
        });

        // En dev, dejar el error visible en consola con su stack
        // crudo para que devtools lo capture.
        if (IS_DEV) {
            // eslint-disable-next-line no-console
            console.error('[ErrorBoundary]', error, errorInfo);
        }
    }

    handleReload = () => {
        // Limpiar query/hash y recargar. Si el error vivía en la ruta
        // actual, ir a / evita un loop.
        try {
            window.location.hash = '#/';
        } catch {
            // ignore
        }
        window.location.reload();
    };

    handleGoHome = () => {
        try {
            window.location.hash = '#/';
        } catch {
            window.location.assign('/');
        }
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        // Modo silencioso: solo loguear y devolver children (no recomendado
        // en prod, util en dev para no romper el flow de testing).
        if (this.props.silent) {
            return this.props.children;
        }

        // Si el caller paso un fallback custom, usarlo.
        if (typeof this.props.fallback === 'function') {
            return this.props.fallback(this.state.error, this.state.errorInfo);
        }

        // UI default amable. Inline styles para evitar dependencia de
        // Tailwind cargado (si Tailwind falla en cargar, igual se ve OK).
        return (
            <div
                style={{
                    minHeight: '100vh',
                    background: '#0a101f',
                    color: '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '24px',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    textAlign: 'center',
                }}
            >
                <div
                    style={{
                        width: '72px',
                        height: '72px',
                        borderRadius: '20px',
                        background: 'linear-gradient(135deg, #3B82F6, #60A5FA)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '24px',
                        boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)',
                    }}
                >
                    <span style={{ fontSize: '36px', fontWeight: 900, color: '#fff' }}>H</span>
                </div>

                <h1 style={{ margin: '0 0 12px', fontSize: '24px', fontWeight: 800 }}>
                    Algo salió mal
                </h1>
                <p style={{ margin: '0 0 32px', maxWidth: '420px', color: '#9ca3af', lineHeight: 1.6 }}>
                    La app encontró un error inesperado y se cerró esta pantalla.
                    Ya recibimos el reporte automáticamente. Podés volver al inicio
                    o recargar para intentar de nuevo.
                </p>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button
                        onClick={this.handleReload}
                        style={{
                            padding: '12px 24px',
                            background: '#3B82F6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '999px',
                            fontWeight: 700,
                            fontSize: '14px',
                            cursor: 'pointer',
                            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                        }}
                    >
                        Recargar
                    </button>
                    <button
                        onClick={this.handleGoHome}
                        style={{
                            padding: '12px 24px',
                            background: 'transparent',
                            color: '#fff',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '999px',
                            fontWeight: 700,
                            fontSize: '14px',
                            cursor: 'pointer',
                        }}
                    >
                        Volver al inicio
                    </button>
                </div>

                {IS_DEV && this.state.error && (
                    <details
                        style={{
                            marginTop: '32px',
                            maxWidth: '90vw',
                            width: '720px',
                            textAlign: 'left',
                            background: '#000',
                            color: '#f87171',
                            padding: '16px',
                            borderRadius: '12px',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            border: '1px solid #7f1d1d',
                        }}
                    >
                        <summary style={{ cursor: 'pointer', color: '#fca5a5', fontWeight: 700 }}>
                            Stack (solo visible en dev)
                        </summary>
                        <pre style={{ marginTop: '8px', overflow: 'auto', maxHeight: '40vh' }}>
                            {this.state.error.toString()}
                            {'\n\n'}
                            {this.state.errorInfo?.componentStack}
                        </pre>
                    </details>
                )}
            </div>
        );
    }
}

export default ErrorBoundary;
