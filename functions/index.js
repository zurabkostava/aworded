//index.js
const { onSchedule } = require("firebase-functions/v2/scheduler");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// ეს არის დაგეგმილი ფუნქცია რომელიც ყოველ წუთში გაეშვება
exports.sendScheduledNotifications = onSchedule("* * * * *", async (event) => {
    const now = new Date();
    const currentTime = now.toTimeString().substring(0, 5); // "HH:MM"
    const currentDay = now.getDay(); // 0 = Sunday

    const reminderSnapshot = await db.collection("reminders").get();
    const cardSnapshot = await db.collection("cards").get(); // სიტყვების კოლექცია

    const allCards = cardSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    for (const doc of reminderSnapshot.docs) {
        const data = doc.data();
        const { time, days, tag, excludeMastered, fcmToken } = data;

        if (!fcmToken || !days.includes(currentDay) || time !== currentTime) continue;

        // ფილტრაცია
        let filteredCards = allCards;

        if (tag) {
            filteredCards = filteredCards.filter(card => (card.tags || []).includes(tag));
        }

        if (excludeMastered) {
            filteredCards = filteredCards.filter(card => (card.progress || 0) < 100);
        }

        if (filteredCards.length === 0) continue;

        const randomCard = filteredCards[Math.floor(Math.random() * filteredCards.length)];
        const word = randomCard.word;
        const translation = (randomCard.mainTranslations || []).join(', ');
        const extra = (randomCard.extraTranslations || []).join(', ');

        const body = extra ? `${translation} (${extra})` : translation;

        try {
            await messaging.send({
                notification: {
                    title: `📖 ${word}`,
                    body: body || "დროა გაიმეორო სიტყვები!"
                },
                token: fcmToken,
                android: {
                    priority: "high",
                    notification: {
                        icon: "ic_notification",
                        color: "#0077cc"
                    }
                }
            });

            console.log("✅ Notification sent:", word);
        } catch (err) {
            console.error("❌ Send error:", err);
        }
    }

    return null;
});

