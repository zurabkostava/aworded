//firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyC6gDMXnPCgM9qwSZGUZMhmnMTVbL5Hz6w",
    authDomain: "aworded-app.firebaseapp.com",
    projectId: "aworded-app",
    storageBucket: "aworded-app.firebasestorage.app",
    messagingSenderId: "895585921946",
    appId: "1:895585921946:web:a01e49fec5523b4d1ae823",
    measurementId: "G-J2KF1BRX07"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/icons/icon-192.png'
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});
