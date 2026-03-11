// ==== tts.js ====

const VOICE_STORAGE_KEY = 'selected_voice_name';
const GEORGIAN_VOICE_KEY = 'selected_georgian_voice';
const ENGLISH_RATE_KEY = 'english_voice_rate';
const GEORGIAN_RATE_KEY = 'georgian_voice_rate';
const GOOGLE_TTS_VOICE_NAME = '🌐 Google TTS (ქართული)';

let selectedVoice = null;
let selectedGeorgianVoice = null;
let isSpeaking = false;
let lastSpokenButton = null;
let currentGoogleAudio = null;

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
    // Force a fresh getVoices() call to pick up late-loading online voices
    speechSynthesis.getVoices();

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

    // Also refresh Georgian dropdown
    populateGeorgianDropdown();
}

function populateGeorgianDropdown() {
    const geoSelect = document.getElementById('georgianVoiceSelect');
    if (!geoSelect) return;
    geoSelect.innerHTML = '';

    // Always add Google TTS as first option (works in all browsers)
    const googleOption = document.createElement('option');
    googleOption.value = GOOGLE_TTS_VOICE_NAME;
    googleOption.textContent = GOOGLE_TTS_VOICE_NAME;
    if (localStorage.getItem(GEORGIAN_VOICE_KEY) === GOOGLE_TTS_VOICE_NAME) {
        googleOption.selected = true;
    }
    geoSelect.appendChild(googleOption);

    // Add native/multilingual voices
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
    if (voices.length > 0 || retry >= 20) {
        loadVoices();
        // Keep retrying a few more times to catch late-loading online/multilingual voices
        if (retry < 20) {
            setTimeout(() => {
                const newVoices = speechSynthesis.getVoices();
                if (newVoices.length > voices.length) loadVoices();
            }, 2000);
        }
        return;
    }
    setTimeout(() => loadVoicesWithDelay(retry + 1), 300);
}

speechSynthesis.onvoiceschanged = loadVoices;

// Google Translate TTS — works in all browsers for Georgian
function speakWithGoogleTTS(text, rate = 1) {
    return new Promise((resolve, reject) => {
        if (currentGoogleAudio) {
            currentGoogleAudio.pause();
            currentGoogleAudio = null;
        }
        const encoded = encodeURIComponent(text);
        const slow = rate < 0.7;
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ka&q=${encoded}&ttsspeed=${slow ? 0.24 : 1}`;
        const audio = new Audio(url);
        currentGoogleAudio = audio;
        audio.playbackRate = Math.max(0.5, Math.min(rate, 2));
        audio.onended = () => { currentGoogleAudio = null; resolve(); };
        audio.onerror = () => { currentGoogleAudio = null; reject(new Error('Google TTS failed')); };
        audio.play().catch(reject);
    });
}

function isGoogleTTSSelected() {
    return localStorage.getItem(GEORGIAN_VOICE_KEY) === GOOGLE_TTS_VOICE_NAME;
}

function stopGoogleTTS() {
    if (currentGoogleAudio) {
        currentGoogleAudio.pause();
        currentGoogleAudio = null;
    }
}

async function speakWithVoice(text, voiceObj, buttonEl = null, extraText = null, highlightEl = null) {
    if (!text) return;

    // Check if this is a Georgian voice and Google TTS is selected
    const useGoogleTTS = voiceObj === selectedGeorgianVoice && isGoogleTTSSelected();

    if (!useGoogleTTS && (!window.speechSynthesis || !voiceObj)) return;

    // Stop any previous speech
    stopGoogleTTS();
    if (window.speechSynthesis) speechSynthesis.cancel();
    await delay(100);

    const speak = (txt, el) => {
        return new Promise(resolve => {
            if (el) el.classList.add('highlighted-sentence');
            if (buttonEl) buttonEl.classList.add('active');

            if (useGoogleTTS) {
                const rate = parseFloat(localStorage.getItem(GEORGIAN_RATE_KEY) || 1);
                speakWithGoogleTTS(txt, rate)
                    .then(() => {
                        if (el) el.classList.remove('highlighted-sentence');
                        if (buttonEl) buttonEl.classList.remove('active');
                        resolve();
                    })
                    .catch(() => {
                        if (el) el.classList.remove('highlighted-sentence');
                        if (buttonEl) buttonEl.classList.remove('active');
                        resolve();
                    });
                return;
            }

            const utterance = new SpeechSynthesisUtterance(txt);
            utterance.voice = voiceObj;
            utterance.lang = voiceObj.lang;

            const rate = (voiceObj.lang === 'ka-GE')
                ? parseFloat(localStorage.getItem(GEORGIAN_RATE_KEY) || 1)
                : parseFloat(localStorage.getItem(ENGLISH_RATE_KEY) || 1);

            utterance.rate = rate;

            utterance.onend = () => {
                if (el) el.classList.remove('highlighted-sentence');
                if (buttonEl) buttonEl.classList.remove('active');
                resolve();
            };

            speechSynthesis.speak(utterance);
        });
    };

    await speak(text, highlightEl);

    if (extraText) {
        await delay(100);
        await speak(extraText, highlightEl);
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
