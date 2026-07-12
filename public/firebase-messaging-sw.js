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
    payload.notification?.title ||
    payload.data?.title ||
    "Chilli Farm Alert";

  const options = {
    body:
      payload.notification?.body ||
      payload.data?.body ||
      "A farm event has been detected.",

    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",

    data: {
      url: payload.data?.url || "/",
    },

    tag: payload.data?.type || "chilli-farm-alert",
    renotify: false,
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const destination =
    event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(destination);
          return client.focus();
        }
      }

      return clients.openWindow(destination);
    })
  );
});