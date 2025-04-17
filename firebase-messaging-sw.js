import { getFirestore, collection, addDoc, doc, setDoc, getDocs, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging.js";

const db = getFirestore();
const messaging = getMessaging();
let currentFcmToken = null;

// მიიღე და შეინახე FCM ტოკენი
export async function initFcmToken() {
    try {
        currentFcmToken = await getToken(messaging, {
            vapidKey: "BI6DQvpq3o0ECfmd_GpKtOihM60QvSBKJGfsu_iOtgNFUoQc_xYvo_AgAFxdRo3HFWk2OK4DjB-x0-uOVQUxpG0"
        });
        console.log("📨 Token: ", currentFcmToken);
    } catch (e) {
        console.error("FCM ტოკენის მიღება ვერ მოხერხდა", e);
    }
}

export async function uploadReminderToFirestore(reminder) {
    if (!currentFcmToken) return console.warn("FCM token არ არის ხელმისაწვდომი");

    const fullReminder = {
        ...reminder,
        token: currentFcmToken,
        createdAt: new Date()
    };

    try {
        await addDoc(collection(db, "reminders"), fullReminder);
        console.log("✅ Reminder ატვირთულია Firestore-ში");
    } catch (err) {
        console.error("❌ Firestore Upload Error", err);
    }
}
