//utils.js

/**
 * განახლებულია: ეს ფუნქცია ახლა მუშაობს 2 რეჟიმში:
 * 1. (სინქრონულად) მომენტალურად ცვლის UI-ს (პროგრესის ბარს).
 * 2. (ასინქრონულად) იძახებს updateCardProgressInDB-ს, რომ ცვლილება ბაზაში შეინახოს.
 */
function updateCardProgress(card, delta) {
    let current = parseFloat(card.dataset.progress || '0');
    current = Math.max(0, Math.min(100, current + delta));
    const newProgress = parseFloat(current.toFixed(1)); // სუფთა, საბოლოო მნიშვნელობა

    card.dataset.progress = newProgress;

    // --- UI-ის განახლება (რჩება იგივე) ---
    if (newProgress >= 100) {
        card.classList.add('mastered');
    } else {
        card.classList.remove('mastered');
    }

    const progressBar = card.querySelector('.progress-bar');
    const label = card.querySelector('.progress-label');

    if (progressBar) {
        progressBar.style.width = `${newProgress}%`;
        progressBar.style.backgroundColor = getProgressColor(newProgress);
    }

    if (label) {
        label.textContent = `${newProgress}%`;
    }
    // --- UI-ის განახლების დასასრული ---


    // --- NEW: ბაზის განახლების გამოძახება ---
    const cardId = card.dataset.id;
    if (cardId) {
        // ჩვენ ვიძახებთ async ფუნქციას, მაგრამ არ "ველოდებით" (no await)
        // ეს UI-ს მომენტალურად ანახლებს და ბაზას ფონურ რეჟიმში წერს.
        updateCardProgressInDB(cardId, newProgress);
    } else {
        console.warn("Skipping progress save: card.dataset.id is missing.");
    }

    // ძველი saveToStorage() აღარ გვჭირდება.
}

/**
 * NEW: ეს ფუნქცია კონკრეტულად Supabase-ში ანახლებს პროგრესს
 */
async function updateCardProgressInDB(cardId, newProgress) {
    // ვამოწმებთ, რომ კლიენტი არსებობს (script.js-დან)
    if (!cardId || typeof supabaseClient === 'undefined') {
        console.error("Cannot update progress: Card ID or Supabase Client is missing.");
        return;
    }

    const { error } = await supabaseClient
        .from('cards')
        .update({
            progress: newProgress,
            updated_at: new Date().toISOString() // განახლების დროის დაფიქსირება
        })
        .eq('id', cardId); // ვანახლებთ მხოლოდ ამ ID-ის ბარათს

    if (error) {
        console.error(`DB Progress Update Error for ${cardId}:`, error.message);
        // showToast(`პროგრესის შენახვა ვერ მოხერხდა`, "error"); // (სურვილისამებრ)
    }
}


function getProgressColor(percent) {
    if (percent <= 10) return '#eee';
    if (percent <= 25) return '#c8e6c9';
    if (percent <= 50) return '#a5d6a7';
    if (percent <= 75) return '#81c784';
    if (percent < 100) return '#66bb6a';
    return '#55d288';
}

