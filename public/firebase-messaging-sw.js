// Configuration is generated from the same environment as the application.
importScripts("./firebase-config.js");
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

const firebaseConfig = self.HIGO_FIREBASE_CONFIG;
if (firebaseConfig) {
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

}

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
