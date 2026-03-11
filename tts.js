// ==== tts.js ====

const VOICE_STORAGE_KEY = 'selected_voice_name';
const GEORGIAN_VOICE_KEY = 'selected_georgian_voice';
const ENGLISH_RATE_KEY = 'english_voice_rate';
const GEORGIAN_RATE_KEY = 'georgian_voice_rate';
const PIPER_VOICE_NAME = '🌐 Piper TTS — Natia (ქართული)';
const PIPER_CDN = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/dist/index.js';
const PIPER_VOICE_ID = 'ka_GE-natia-medium';

let selectedVoice = null;
let selectedGeorgianVoice = null;
let isSpeaking = false;
let lastSpokenButton = null;
let currentPiperAudio = null;
let piperModule = null;

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

    // Always add Piper TTS as first option (works in all browsers)
    const piperOption = document.createElement('option');
    piperOption.value = PIPER_VOICE_NAME;
    piperOption.textContent = PIPER_VOICE_NAME;
    if (localStorage.getItem(GEORGIAN_VOICE_KEY) === PIPER_VOICE_NAME) {
        piperOption.selected = true;
    }
    geoSelect.appendChild(piperOption);

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

// Piper TTS — local neural TTS in the browser via WASM
async function loadPiper() {
    if (piperModule) return piperModule;
    if (typeof showToast === 'function') showToast('ხმის მოდელი იტვირთება...', 'info');
    piperModule = await import(PIPER_CDN);
    // Pre-download Georgian voice model
    await piperModule.download(PIPER_VOICE_ID, (progress) => {
        console.log('[Piper] Download:', Math.round(progress.url ? 50 : 0) + '%');
    });
    if (typeof showToast === 'function') showToast('Piper TTS მზადაა!', 'success');
    return piperModule;
}

function speakWithPiper(text, rate = 1) {
    return new Promise(async (resolve, reject) => {
        try {
            if (currentPiperAudio) {
                currentPiperAudio.pause();
                currentPiperAudio = null;
            }
            const tts = await loadPiper();
            const wav = await tts.predict({
                text: text,
                voiceId: PIPER_VOICE_ID,
            });
            const audio = new Audio();
            audio.src = URL.createObjectURL(wav);
            audio.playbackRate = Math.max(0.5, Math.min(rate, 2));
            currentPiperAudio = audio;
            audio.onended = () => { currentPiperAudio = null; resolve(); };
            audio.onerror = () => { currentPiperAudio = null; reject(new Error('Piper playback failed')); };
            audio.play().catch(reject);
        } catch (e) {
            reject(e);
        }
    });
}

function isPiperTTSSelected() {
    return localStorage.getItem(GEORGIAN_VOICE_KEY) === PIPER_VOICE_NAME;
}

function stopGoogleTTS() {
    if (currentPiperAudio) {
        currentPiperAudio.pause();
        currentPiperAudio = null;
    }
}

async function speakWithVoice(text, voiceObj, buttonEl = null, extraText = null, highlightEl = null) {
    if (!text) return;

    // Check if this is a Georgian voice and Piper TTS is selected
    const usePiperTTS = voiceObj === selectedGeorgianVoice && isPiperTTSSelected();

    if (!usePiperTTS && (!window.speechSynthesis || !voiceObj)) return;

    // Stop any previous speech
    stopGoogleTTS();
    if (window.speechSynthesis) speechSynthesis.cancel();
    await delay(100);

    const speak = (txt, el) => {
        return new Promise(resolve => {
            if (el) el.classList.add('highlighted-sentence');
            if (buttonEl) buttonEl.classList.add('active');

            if (usePiperTTS) {
                const rate = parseFloat(localStorage.getItem(GEORGIAN_RATE_KEY) || 1);
                speakWithPiper(txt, rate)
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
