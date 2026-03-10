// ==== tts.js ====

const VOICE_STORAGE_KEY = 'selected_voice_name';
const GEORGIAN_VOICE_KEY = 'selected_georgian_voice';
const ENGLISH_RATE_KEY = 'english_voice_rate';
const GEORGIAN_RATE_KEY = 'georgian_voice_rate';

let selectedVoice = null;
let selectedGeorgianVoice = null;
let isSpeaking = false;
let lastSpokenButton = null;

function getEnglishVoices() {
    return speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
}

function getGeorgianVoices() {
    const voices = speechSynthesis.getVoices();
    const georgian = voices.filter(v => v.lang.startsWith('ka'));
    const multilingual = voices.filter(v => v.name.toLowerCase().includes('multilingual') && !v.lang.startsWith('ka'));
    return [...georgian, ...multilingual];
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadSpeechRates() {
    const englishRateSlider = document.getElementById('englishRateSlider');
    const georgianRateSlider = document.getElementById('georgianRateSlider');

    englishRateSlider.value = localStorage.getItem(ENGLISH_RATE_KEY) || 1;
    georgianRateSlider.value = localStorage.getItem(GEORGIAN_RATE_KEY) || 1;
}

function populateVoiceDropdown() {
    const voiceSelect = document.getElementById('voiceSelect');
    if (!voiceSelect) return;
    voiceSelect.innerHTML = '';

    getEnglishVoices().forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.name;
        option.textContent = voice.name;
        if (localStorage.getItem(VOICE_STORAGE_KEY) === voice.name) {
            option.selected = true;
            selectedVoice = voice;
        }
        voiceSelect.appendChild(option);
    });
}

function populateGeorgianDropdown() {
    const geoSelect = document.getElementById('georgianVoiceSelect');
    if (!geoSelect) return;
    geoSelect.innerHTML = '';

    getGeorgianVoices().forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.name;
        option.textContent = voice.name;
        if (localStorage.getItem(GEORGIAN_VOICE_KEY) === voice.name) {
            option.selected = true;
            selectedGeorgianVoice = voice;
        }
        geoSelect.appendChild(option);
    });
}

function loadVoices() {
    const voices = speechSynthesis.getVoices();
    populateVoiceDropdown();
    populateGeorgianDropdown();

    const storedVoice = localStorage.getItem(VOICE_STORAGE_KEY);
    selectedVoice = voices.find(v => v.name === storedVoice);

    // 📱 fallback for mobile: default English voice
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
    }

    const storedGeo = localStorage.getItem(GEORGIAN_VOICE_KEY);
    selectedGeorgianVoice = voices.find(v => v.name === storedGeo);

    // 📱 fallback for mobile: default Georgian voice or similar
    if (!selectedGeorgianVoice) {
        selectedGeorgianVoice = voices.find(v => v.lang === 'ka-GE') || voices.find(v => v.lang.startsWith('en')) || voices[0];
    }
}


function loadVoicesWithDelay(retry = 0) {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0 || retry >= 10) {
        loadVoices();
        return;
    }
    setTimeout(() => loadVoicesWithDelay(retry + 1), 200);
}

speechSynthesis.onvoiceschanged = loadVoices;

async function speakWithVoice(text, voiceObj, buttonEl = null, extraText = null, highlightEl = null) {
    if (!window.speechSynthesis || !voiceObj || !text) return;

    // 🔁 უარყავი წინა წამკითხავი
    speechSynthesis.cancel();
    await delay(100);

    const speak = (txt, el) => {
        return new Promise(resolve => {
            const utterance = new SpeechSynthesisUtterance(txt);
            utterance.voice = voiceObj;
            utterance.lang = voiceObj.lang;

            const rate = (voiceObj.lang === 'ka-GE')
                ? parseFloat(localStorage.getItem(GEORGIAN_RATE_KEY) || 1)
                : parseFloat(localStorage.getItem(ENGLISH_RATE_KEY) || 1);

            utterance.rate = rate;

            // 🔦 Highlight დაწყება
            if (el) el.classList.add('highlighted-sentence');

            utterance.onend = () => {
                // 🔦 Highlight მოცილება
                if (el) el.classList.remove('highlighted-sentence');
                if (buttonEl) buttonEl.classList.remove('active');
                resolve();
            };

            // გააქტიურე ღილაკიც
            if (buttonEl) buttonEl.classList.add('active');

            speechSynthesis.speak(utterance);
        });
    };

    await speak(text, highlightEl);

    if (extraText) {
        await delay(100);
        await speak(extraText, highlightEl); // გამოიყენე იგივე highlight
    }
}



document.addEventListener('click', (e) => {
    const speakBtn = e.target.closest('.speak-btn');
    if (!speakBtn) return;

    e.stopPropagation();

    const text = speakBtn.dataset.text || speakBtn.dataset.word;
    const extraText = speakBtn.dataset.extra || null;
    const lang = speakBtn.dataset.lang;

    if (lang === 'ka') {
        speakWithVoice(text, selectedGeorgianVoice, speakBtn, extraText);
    } else {
        speakWithVoice(text, selectedVoice, speakBtn);
    }
});
