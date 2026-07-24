import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'
import 'material-symbols/outlined.css'; // Offline Icons

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/firebase-messaging-sw.js')
    .catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary source="app-root">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
