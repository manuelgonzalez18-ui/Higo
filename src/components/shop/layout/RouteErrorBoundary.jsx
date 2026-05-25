import { Component } from 'react';

// Catches chunk-load errors from React.lazy when the user's network drops
// between navigations or a deploy invalidates the old chunk hashes. Without
// this, a failed dynamic import shows a blank screen.
export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (typeof console !== 'undefined') {
      console.error('Route load failed:', error);
    }

    const msg = String(error?.message || '');
    const isChunkError = msg.includes('Failed to fetch dynamically imported module') || msg.includes('Loading chunk');
    if (!isChunkError || typeof window === 'undefined') return;

    const key = 'higo-shop:chunk-reload-once';
    const alreadyReloaded = window.sessionStorage.getItem(key) === '1';
    if (!alreadyReloaded) {
      window.sessionStorage.setItem(key, '1');
      window.location.reload();
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60dvh',
        padding: '2rem',
        textAlign: 'center',
        gap: '1rem',
      }}>
        <div style={{ fontSize: 48 }}>📡</div>
        <h2 style={{ margin: 0, color: 'var(--higo-gray-900)', fontSize: 'var(--font-lg)' }}>
          No pudimos cargar esta sección
        </h2>
        <p style={{ color: 'var(--higo-gray-500)', maxWidth: 320, margin: 0 }}>
          Puede ser un problema temporal de conexión. Vuelve a intentar.
        </p>
        <button
          onClick={this.handleReload}
          style={{
            background: 'var(--higo-blue)',
            color: 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }
}
