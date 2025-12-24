import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import 'material-symbols/outlined.css'; // Offline Icons

// --- TRAMPA DE ERRORES (SOLO PARA DIAGNÓSTICO) ---
// Esto mostrará cualquier error oculto directamente en la pantalla del celular
window.onerror = function (message, source, lineno, colno, error) {
  document.body.innerHTML = `
    <div style="background:white; color:red; padding:20px; font-family:sans-serif;">
      <h1 style="font-size:24px; border-bottom: 2px solid red;">🚨 Error Detectado</h1>
      <p><strong>Mensaje:</strong> ${message}</p>
      <p><strong>Archivo:</strong> ${source}</p>
      <p><strong>Línea:</strong> ${lineno}</p>
      <p style="color:gray; font-size:14px;">Tómale una captura a esto y envíala al chat.</p>
    </div>
  `;
  return false;
};

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/firebase-messaging-sw.js')
    .then((registration) => {
      console.log('Service Worker registered with scope:', registration.scope);
    })
    .catch((err) => {
      console.log('Service Worker registration failed:', err);
    });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)