// ==== tts.js ====

const VOICE_STORAGE_KEY = 'selected_voice_name';
const GEORGIAN_VOICE_KEY = 'selected_georgian_voice';
const ENGLISH_RATE_KEY = 'english_voice_rate';
const GEORGIAN_RATE_KEY = 'georgian_voice_rate';
const PIPER_VOICE_NAME = '🌐 Piper TTS — Natia (ქართული)';
const PIPER_VOICE_PATH = 'ka/ka_GE/natia/medium/ka_GE-natia-medium';

let selectedVoice = null;
let selectedGeorgianVoice = null;
let isSpeaking = false;
let lastSpokenButton = null;
let currentPiperAudio = null;
let piperWorker = null;
let piperReady = false;
let piperInitializing = false;
let piperQueue = []; // callbacks waiting for synthesis

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

// Piper TTS — local neural TTS in the browser via Web Worker + WASM
// piperQueue holds {text, resolve, reject} — resolve receives WAV blob
let piperPendingCallbacks = []; // callbacks waiting for output/error from worker

function initPiperWorker() {
    if (piperWorker) return;
    if (piperInitializing) return;
    piperInitializing = true;

    if (typeof showToast === 'function') showToast('ხმის მოდელი იტვირთება...', 'info');
    console.log('[Piper] Starting worker...');

    piperWorker = new Worker('piper-worker.js');

    piperWorker.addEventListener('message', (e) => {
        const { kind, wav, message } = e.data;

        if (kind === 'ready') {
            piperReady = true;
            piperInitializing = false;
            console.log('[Piper] Worker ready!');
            if (typeof showToast === 'function') showToast('Piper TTS მზადაა!', 'success');
            // Process any queued requests
            while (piperQueue.length > 0) {
                const queued = piperQueue.shift();
                piperPendingCallbacks.push(queued);
                piperWorker.postMessage({ kind: 'synthesize', text: queued.text });
            }
        } else if (kind === 'output') {
            if (piperPendingCallbacks.length > 0) {
                const cb = piperPendingCallbacks.shift();
                cb.resolve(wav);
            }
        } else if (kind === 'error') {
            console.error('[Piper] Error:', message);
            if (piperPendingCallbacks.length > 0) {
                const cb = piperPendingCallbacks.shift();
                cb.reject(new Error(message));
            }
            if (!piperReady) {
                // Init failed — reject all queued items too
                piperInitializing = false;
                while (piperQueue.length > 0) {
                    piperQueue.shift().reject(new Error(message));
                }
                if (typeof showToast === 'function') showToast('Piper TTS ვერ ჩაიტვირთა', 'error');
            }
        } else if (kind === 'status') {
            console.log('[Piper]', message);
        }
    });

    piperWorker.postMessage({ kind: 'init', voicePath: PIPER_VOICE_PATH });
}

function speakWithPiper(text, rate = 1) {
    return new Promise((resolve, reject) => {
        if (currentPiperAudio) {
            currentPiperAudio.pause();
            currentPiperAudio = null;
        }

        initPiperWorker();

        const onWav = (wav) => {
            const audio = new Audio();
            audio.src = URL.createObjectURL(wav);
            audio.playbackRate = Math.max(0.5, Math.min(rate, 2));
            currentPiperAudio = audio;
            audio.onended = () => { currentPiperAudio = null; resolve(); };
            audio.onerror = () => { currentPiperAudio = null; reject(new Error('Piper playback failed')); };
            audio.play().catch(reject);
        };

        if (piperReady) {
            piperPendingCallbacks.push({ resolve: onWav, reject });
            piperWorker.postMessage({ kind: 'synthesize', text });
        } else {
            // Worker still loading — queue this request
            piperQueue.push({ text, resolve: onWav, reject });
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

    // Check if caller passed the Georgian voice slot and Piper TTS is selected
    const usePiperTTS = isPiperTTSSelected() && voiceObj === selectedGeorgianVoice;

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
