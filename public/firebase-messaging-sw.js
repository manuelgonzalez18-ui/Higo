// Scripts for firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyAcoBzdfPRJ76luR-bTjW4Kxen3dWZ0Xn4",
    authDomain: "higo-app-26a19.firebaseapp.com",
    projectId: "higo-app-26a19",
    storageBucket: "higo-app-26a19.firebasestorage.app",
    messagingSenderId: "402695441944",
    appId: "1:402695441944:web:104db3fe36029e2c36bd6d",
    measurementId: "G-0N2ZDGDGNT"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    // Customize notification here (e.g. vibration, sound)
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/higo-icon.svg',
        vibrate: [200, 100, 200, 100, 200, 100, 200], // Custom vibration pattern
        sound: 'default', // Or link to a custom sound file in public folder if browser supports it
        data: { url: payload.data?.click_action || '/' }
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function (event) {
    console.log('[firebase-messaging-sw.js] Notification click Received.', event);
    event.notification.close();

    // Si la push trajo una URL específica (ej. /#/higo-pay), preferirla.
    // Si ya hay un cliente del mismo origen abierto, foco + navegación.
    var targetUrl = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
                    if ('navigate' in client) client.navigate(targetUrl).catch(function () {});
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
