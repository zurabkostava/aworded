// ==== Piper TTS Web Worker ====
// Runs Piper neural TTS locally in the browser via WASM + ONNX Runtime

const PIPER_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/';
const ORT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/ort.min.js';
const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

let phonemizeModule = null;
let phonemizeCallback = null;
let ortSession = null;
let modelConfig = null;

function PCM2WAV(buffer, sampleRate) {
    const numChannels = 1;
    const bytesPerSample = 2;
    const dataLength = buffer.length * bytesPerSample;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;
    const wav = new ArrayBuffer(totalLength);
    const view = new DataView(wav);

    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, 'data');
    view.setUint32(40, dataLength, true);

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
    importScripts(PIPER_WASM_BASE + 'piper_phonemize.js');

    // createPiperPhonemize is the Emscripten factory function
    phonemizeModule = await createPiperPhonemize({
        print: (data) => {
            // This callback receives phonemize JSON output
            if (phonemizeCallback) {
                try {
                    phonemizeCallback(JSON.parse(data));
                } catch (e) {
                    phonemizeCallback(null);
                }
                phonemizeCallback = null;
            }
        },
        printErr: (msg) => {
            console.error('[PiperPhonemize]', msg);
        },
        locateFile: (url) => {
            return PIPER_WASM_BASE + url;
        },
    });

    // 3. Download voice model config + ONNX model
    self.postMessage({ kind: 'status', message: 'კონფიგურაცია იტვირთება...' });
    const configResp = await fetch(HF_BASE + voicePath + '.onnx.json');
    if (!configResp.ok) throw new Error('Failed to fetch voice config');
    modelConfig = await configResp.json();

    self.postMessage({ kind: 'status', message: 'ხმის მოდელი იტვირთება (~60MB)...' });
    const modelResp = await fetch(HF_BASE + voicePath + '.onnx');
    if (!modelResp.ok) throw new Error('Failed to fetch voice model');
    const modelBuffer = await modelResp.arrayBuffer();

    self.postMessage({ kind: 'status', message: 'მოდელი ინიციალიზდება...' });
    ortSession = await ort.InferenceSession.create(modelBuffer);

    self.postMessage({ kind: 'ready' });
}

function phonemize(text) {
    return new Promise((resolve, reject) => {
        const voice = modelConfig.espeak.voice;

        phonemizeCallback = (data) => {
            if (data && data.phoneme_ids) {
                resolve(data.phoneme_ids);
            } else {
                reject(new Error('Phonemization failed'));
            }
        };

        try {
            phonemizeModule.callMain([
                '-l', voice,
                '--input', JSON.stringify([{ text }]),
                '--espeak_data', '/espeak-ng-data',
            ]);
        } catch (e) {
            // callMain may throw after producing output — check if callback was called
            if (phonemizeCallback) {
                phonemizeCallback = null;
                reject(new Error('callMain failed: ' + e.message));
            }
        }
    });
}

async function synthesize(text) {
    const phonemeIds = await phonemize(text);

    if (!phonemeIds || phonemeIds.length === 0) {
        self.postMessage({ kind: 'error', message: 'ტექსტი ვერ გარდაიქმნა ფონემებად' });
        return;
    }

    const ids = new BigInt64Array(phonemeIds.map(id => BigInt(id)));

    const sampleRate = modelConfig.audio.sample_rate || 22050;
    const noiseScale = modelConfig.inference?.noise_scale ?? 0.667;
    const lengthScale = modelConfig.inference?.length_scale ?? 1.0;
    const noiseW = modelConfig.inference?.noise_w ?? 0.8;

    const feeds = {
        input: new ort.Tensor('int64', ids, [1, ids.length]),
        input_lengths: new ort.Tensor('int64', [BigInt(ids.length)], [1]),
        scales: new ort.Tensor('float32', [noiseScale, lengthScale, noiseW], [3]),
    };

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
