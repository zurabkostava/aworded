// ==== Piper TTS Web Worker ====
// Runs Piper neural TTS locally in the browser via WASM + ONNX Runtime

const PIPER_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/';
const ORT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/ort.min.js';
const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

let piperModule = null;
let ortSession = null;
let modelConfig = null;

// Cache downloaded blobs to avoid re-downloading
const blobCache = {};

async function fetchWithProgress(url, label) {
    if (blobCache[url]) return blobCache[url];
    self.postMessage({ kind: 'status', message: `${label} იტვირთება...` });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    const blob = await response.blob();
    blobCache[url] = blob;
    return blob;
}

function PCM2WAV(buffer, sampleRate) {
    const numChannels = 1;
    const bytesPerSample = 2;
    const dataLength = buffer.length * bytesPerSample;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;
    const wav = new ArrayBuffer(totalLength);
    const view = new DataView(wav);

    // RIFF header
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, 'data');
    view.setUint32(40, dataLength, true);

    // PCM data (float32 → int16)
    for (let i = 0; i < buffer.length; i++) {
        const s = Math.max(-1, Math.min(1, buffer[i]));
        view.setInt16(headerLength + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([wav], { type: 'audio/wav' });
}

async function init(voicePath) {
    // 1. Load ONNX Runtime
    self.postMessage({ kind: 'status', message: 'ONNX Runtime იტვირთება...' });
    importScripts(ORT_CDN);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/';

    // 2. Load Piper phonemize WASM
    self.postMessage({ kind: 'status', message: 'Piper Phonemize იტვირთება...' });

    // Override Emscripten's file locator to use CDN
    self.Module = {
        locateFile: (path) => PIPER_WASM_BASE + path,
        print: () => {},
        printErr: () => {},
    };
    importScripts(PIPER_WASM_BASE + 'piper_phonemize.js');

    // Wait for WASM to be ready
    if (typeof createPiperPhonemize === 'function') {
        piperModule = await createPiperPhonemize({
            locateFile: (path) => PIPER_WASM_BASE + path,
            print: () => {},
            printErr: () => {},
        });
    } else if (self.Module && self.Module.calledRun) {
        piperModule = self.Module;
    } else {
        // Wait for Module to initialize
        await new Promise((resolve) => {
            const check = setInterval(() => {
                if (self.Module && self.Module.calledRun) {
                    piperModule = self.Module;
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });
    }

    // 3. Download voice model
    const configBlob = await fetchWithProgress(HF_BASE + voicePath + '.onnx.json', 'კონფიგურაცია');
    modelConfig = JSON.parse(await configBlob.text());

    const modelBlob = await fetchWithProgress(HF_BASE + voicePath + '.onnx', 'ხმის მოდელი (~60MB)');
    const modelBuffer = await modelBlob.arrayBuffer();

    self.postMessage({ kind: 'status', message: 'მოდელი ინიციალიზდება...' });
    ortSession = await ort.InferenceSession.create(modelBuffer);

    self.postMessage({ kind: 'ready' });
}

function textToPhonemeIds(text) {
    const input = JSON.stringify([{ text }]);
    const voice = modelConfig.espeak.voice;

    // Call piper_phonemize via Emscripten
    const outputPtr = piperModule._malloc(4);
    const outputLenPtr = piperModule._malloc(4);

    // Use callMain to phonemize
    const origLog = console.log;
    let phonemeOutput = '';
    console.log = (msg) => { phonemeOutput += msg + '\n'; };

    try {
        piperModule.callMain([
            '-l', voice,
            '--input', input,
            '--espeak_ng_data', '/espeak-ng-data'
        ]);
    } catch (e) {
        // callMain may throw after output
    }
    console.log = origLog;

    // Parse phoneme IDs from output
    const idMap = modelConfig.phoneme_id_map;
    const phonemes = phonemeOutput.trim();
    const ids = [0]; // BOS

    for (const char of phonemes) {
        if (idMap[char]) {
            ids.push(...idMap[char]);
        }
    }
    ids.push(0); // EOS

    return new BigInt64Array(ids.map(id => BigInt(id)));
}

async function synthesize(text) {
    const phonemeIds = textToPhonemeIds(text);

    if (phonemeIds.length <= 2) {
        self.postMessage({ kind: 'error', message: 'ტექსტი ვერ გარდაიქმნა ფონემებად' });
        return;
    }

    const sampleRate = modelConfig.audio.sample_rate || 22050;
    const noiseScale = modelConfig.inference?.noise_scale ?? 0.667;
    const lengthScale = modelConfig.inference?.length_scale ?? 1.0;
    const noiseW = modelConfig.inference?.noise_w ?? 0.8;

    const feeds = {
        input: new ort.Tensor('int64', phonemeIds, [1, phonemeIds.length]),
        input_lengths: new ort.Tensor('int64', [BigInt(phonemeIds.length)], [1]),
        scales: new ort.Tensor('float32', [noiseScale, lengthScale, noiseW], [3]),
    };

    // Add speaker ID if multi-speaker model
    if (modelConfig.num_speakers > 1) {
        feeds.sid = new ort.Tensor('int64', [BigInt(0)], [1]);
    }

    const result = await ortSession.run(feeds);
    const pcm = result.output.data;
    const wav = PCM2WAV(pcm, sampleRate);

    self.postMessage({ kind: 'output', wav });
}

// Message handler
self.addEventListener('message', async (event) => {
    const { kind, text, voicePath } = event.data;

    try {
        if (kind === 'init') {
            await init(voicePath);
        } else if (kind === 'synthesize') {
            await synthesize(text);
        }
    } catch (e) {
        self.postMessage({ kind: 'error', message: e.message || String(e) });
    }
});
