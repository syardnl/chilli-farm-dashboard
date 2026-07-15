importScripts(
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyC02DgQU1uEsZI90PZjI0dxGEbfrn0xwtA",
  authDomain: "chilli-farm-notification.firebaseapp.com",
  projectId: "chilli-farm-notification",
  storageBucket: "chilli-farm-notification.firebasestorage.app",
  messagingSenderId: "911607708461",
  appId: "1:911607708461:web:8021785445b23e745c71a4",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] Background message:",
    payload
  );

  const title =
    payload.data?.title ||
    payload.notification?.title ||
    "Chilli Farm Alert";

  const body =
    payload.data?.body ||
    payload.notification?.body ||
    "A farm event has been detected.";

  const type = payload.data?.type || "general";
  const url = payload.data?.url || "/";

  return self.registration.showNotification(title, {
    body,
    icon: "/icon/icon-192.png",
    badge: "/icon/icon-192.png",
    tag: `chilli-farm-${type}`,
    renotify: false,
    data: { url },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const destination = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then(async (clientList) => {
        for (const client of clientList) {
          if ("navigate" in client) {
            await client.navigate(destination);
          }

          if ("focus" in client) {
            return client.focus();
          }
        }

        return clients.openWindow(destination);
      })
  );
});
