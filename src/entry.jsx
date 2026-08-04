const route = window.location.hash.split('?')[0];

const showBootError = (error) => {
    console.error('[Higo boot] No se pudo cargar la aplicación:', error);
    document.body.innerHTML = `
        <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1014;color:#fff;padding:24px;font-family:Arial,sans-serif;">
            <section style="max-width:560px;background:#1a1f2e;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:28px;text-align:center;">
                <h1 style="margin:0 0 12px;font-size:24px;">No se pudo cargar Higo</h1>
                <p style="margin:0 0 18px;color:#a1a1aa;line-height:1.5;">Recarga la página. Si el problema continúa, revisa la consola del navegador o contacta al equipo técnico.</p>
                <button onclick="window.location.reload()" style="border:0;border-radius:12px;padding:12px 18px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer;">Recargar</button>
            </section>
        </main>`;
};

if (route === '#/admin/rides') {
    import('./adminRidesEntry.jsx').catch(showBootError);
} else {
    import('./main.jsx').catch(showBootError);
}
