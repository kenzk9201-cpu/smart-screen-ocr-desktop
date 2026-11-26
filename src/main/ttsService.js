// ttsService.js - 跨平台高品質自然語音合成服務模組
// 支援三種引擎模式：
// 1. edge-neural：Microsoft Edge 大聲朗讀神經網路語音（預設、免費免金鑰，輸出真實 MP3）
// 2. google-gemini：Google Gemini 官方 Audio TTS（高擬真自然語音，將 24kHz PCM 轉為標準 WAV）
// 3. system-local：交由前端使用系統內建地端語音引擎（優先 Google localService）

'use strict';

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Gemini 官方文字轉語音模型端點
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// 支援的語音引擎清單（供設定頁面下拉選單顯示）
const TTS_ENGINES = Object.freeze([
  {
    id: 'edge-neural',
    label: '🌟 Edge 自然神經語音（推薦・免金鑰）',
    description: '與 Microsoft Edge「大聲朗讀」同款自然人聲，免設定 API Key 即可使用。'
  },
  {
    id: 'google-gemini',
    label: '✨ Google Gemini 官方自然語音（需 Gemini API Key）',
    description: '呼叫 Google 官方 Gemini Audio TTS 產生高擬真自然人聲。'
  },
  {
    id: 'system-local',
    label: '🖥️ 系統內建地端語音（離線可用）',
    description: '使用作業系統或瀏覽器內建語音引擎（優先選用 Google 地端語音）。'
  }
]);

// Edge 神經網路語音清單（依語系分類，嚴格排除簡體中文語系）
const EDGE_VOICES_BY_LANG = Object.freeze({
  'zh-TW': Object.freeze([
    { id: 'zh-TW-HsiaoChenNeural', label: '🇹🇼 曉臻 (台灣女聲・自然親切)', gender: 'Female', lang: 'zh-TW' },
    { id: 'zh-TW-YunJheNeural', label: '🇹🇼 雲哲 (台灣男聲・沉穩清晰)', gender: 'Male', lang: 'zh-TW' },
    { id: 'zh-TW-HsiaoYuNeural', label: '🇹🇼 曉雨 (台灣女聲・柔和流暢)', gender: 'Female', lang: 'zh-TW' }
  ]),
  'en-US': Object.freeze([
    { id: 'en-US-JennyNeural', label: '🇺🇸 Jenny (美式女聲・自然流暢)', gender: 'Female', lang: 'en-US' },
    { id: 'en-US-GuyNeural', label: '🇺🇸 Guy (美式男聲・清晰沉穩)', gender: 'Male', lang: 'en-US' },
    { id: 'en-US-AriaNeural', label: '🇺🇸 Aria (美式女聲・活潑生動)', gender: 'Female', lang: 'en-US' }
  ]),
  'en-GB': Object.freeze([
    { id: 'en-GB-SoniaNeural', label: '🇬🇧 Sonia (英式女聲・優雅標準)', gender: 'Female', lang: 'en-GB' }
  ]),
  'ja-JP': Object.freeze([
    { id: 'ja-JP-NanamiNeural', label: '🇯🇵 Nanami (日語女聲・自然清晰)', gender: 'Female', lang: 'ja-JP' }
  ]),
  'ko-KR': Object.freeze([
    { id: 'ko-KR-SunHiNeural', label: '🇰🇷 SunHi (韓語女聲・溫和流暢)', gender: 'Female', lang: 'ko-KR' }
  ]),
  'es-ES': Object.freeze([
    { id: 'es-ES-ElviraNeural', label: '🇪🇸 Elvira (西班牙語女聲)', gender: 'Female', lang: 'es-ES' }
  ]),
  'fr-FR': Object.freeze([
    { id: 'fr-FR-DeniseNeural', label: '🇫🇷 Denise (法語女聲)', gender: 'Female', lang: 'fr-FR' }
  ]),
  'de-DE': Object.freeze([
    { id: 'de-DE-KatjaNeural', label: '🇩🇪 Katja (德語女聲)', gender: 'Female', lang: 'de-DE' }
  ])
});

// 各語系預設選用的 Edge 神經網路聲線
const DEFAULT_EDGE_VOICE_MAP = Object.freeze({
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  'en-US': 'en-US-JennyNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'ko-KR': 'ko-KR-SunHiNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'de-DE': 'de-DE-KatjaNeural'
});

// Google Gemini 官方 TTS 預建自然聲線清單
const GEMINI_TTS_VOICES = Object.freeze([
  { id: 'Kore', label: 'Kore（清亮自然・預設）' },
  { id: 'Aoede', label: 'Aoede（溫潤柔和）' },
  { id: 'Puck', label: 'Puck（輕快活潑）' },
  { id: 'Charon', label: 'Charon（低沉穩重）' },
  { id: 'Fenrir', label: 'Fenrir（清晰俐落）' },
  { id: 'Leda', label: 'Leda（優雅知性）' }
]);

// 允許的 Edge 聲線 ID 集合（防止外部傳入非預期語系聲線）
const ALLOWED_EDGE_VOICE_IDS = new Set(
  Object.values(EDGE_VOICES_BY_LANG).flat().map((v) => v.id)
);

// 允許的 Gemini 聲線 ID 集合
const ALLOWED_GEMINI_VOICE_IDS = new Set(GEMINI_TTS_VOICES.map((v) => v.id));

/**
 * 取得所有語音引擎與聲線選項（供設定頁與覆蓋層顯示）
 * @returns {{ engines: readonly object[], edgeVoicesByLang: object, geminiVoices: readonly object[] }}
 */
function getTtsOptions() {
  return {
    engines: TTS_ENGINES,
    edgeVoicesByLang: EDGE_VOICES_BY_LANG,
    geminiVoices: GEMINI_TTS_VOICES
  };
}

/**
 * 將語系代碼正規化為本應用程式支援的標準語系（強制將任何中文語系導向繁體中文 zh-TW）
 * @param {string} lang - 原始語系代碼
 * @param {string} text - 待朗讀文字（用於無語系提示時的自動偵測）
 * @returns {string} 標準語系代碼
 */
function resolveTargetLang(lang, text = '') {
  const raw = typeof lang === 'string' ? lang.trim().toLowerCase() : '';
  if (raw) {
    if (raw.startsWith('zh')) return 'zh-TW';
    if (raw === 'en-gb' || raw === 'en_gb') return 'en-GB';
    if (raw.startsWith('en')) return 'en-US';
    if (raw.startsWith('ja')) return 'ja-JP';
    if (raw.startsWith('ko')) return 'ko-KR';
    if (raw.startsWith('es')) return 'es-ES';
    if (raw.startsWith('fr')) return 'fr-FR';
    if (raw.startsWith('de')) return 'de-DE';
  }

  // 未指定語系時依據文字字元特徵自動偵測語言
  const sample = typeof text === 'string' ? text : '';
  if (/[\u3040-\u30ff]/.test(sample)) return 'ja-JP';
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(sample)) return 'ko-KR';
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(sample)) return 'zh-TW';
  return 'en-US';
}

/**
 * 跳脫 XML/SSML 特殊字元，避免辨識文字中含有 <、>、& 導致 Edge TTS SSML 解析錯誤
 * @param {string} text - 原始文字
 * @returns {string} 安全的 SSML 文字內容
 */
function escapeSsmlText(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 為原始 Linear PCM (audio/L16) 音訊加上標準 44-byte RIFF/WAVE 檔案標頭
 * @param {Buffer} pcmBuffer - 原始 16-bit PCM 位元組緩衝區
 * @param {{ sampleRate?: number, channels?: number, bitDepth?: number }} [opts]
 * @returns {Buffer} 完整可播放的 WAV 二進位緩衝區
 */
function pcmToWavBuffer(pcmBuffer, opts = {}) {
  const buffer = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);
  const sampleRate = Number(opts.sampleRate) > 0 ? Math.round(Number(opts.sampleRate)) : 24000;
  const channels = Number(opts.channels) > 0 ? Math.round(Number(opts.channels)) : 1;
  const bitDepth = Number(opts.bitDepth) > 0 ? Math.round(Number(opts.bitDepth)) : 16;

  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = buffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');                 // ChunkID: RIFF
  header.writeUInt32LE(36 + dataSize, 4);           // ChunkSize
  header.write('WAVE', 8, 'ascii');                 // Format: WAVE
  header.write('fmt ', 12, 'ascii');                // Subchunk1ID: fmt
  header.writeUInt32LE(16, 16);                     // Subchunk1Size (PCM = 16)
  header.writeUInt16LE(1, 20);                      // AudioFormat (1 = PCM)
  header.writeUInt16LE(channels, 22);               // NumChannels
  header.writeUInt32LE(sampleRate, 24);             // SampleRate
  header.writeUInt32LE(byteRate, 28);               // ByteRate
  header.writeUInt16LE(blockAlign, 32);             // BlockAlign
  header.writeUInt16LE(bitDepth, 34);               // BitsPerSample
  header.write('data', 36, 'ascii');                // Subchunk2ID: data
  header.writeUInt32LE(dataSize, 40);               // Subchunk2Size

  return Buffer.concat([header, buffer]);
}

/**
 * 從 Gemini 回傳的音訊 MIME Type 解析取樣率（例如 audio/L16;codec=pcm;rate=24000）
 * @param {string} mimeType
 * @returns {number}
 */
function parseSampleRateFromMimeType(mimeType) {
  if (typeof mimeType !== 'string') return 24000;
  const match = /rate=(\d+)/i.exec(mimeType);
  if (match) {
    const rate = Number(match[1]);
    if (Number.isFinite(rate) && rate >= 8000 && rate <= 96000) {
      return rate;
    }
  }
  return 24000;
}

/**
 * 決定 Edge 神經網路語音要使用的實際聲線名稱
 * @param {string} targetLang - 標準語系代碼
 * @param {string} [overrideVoiceName] - 呼叫端指定聲線
 * @param {object} [edgeVoiceMap] - 使用者設定的語系聲線對應表
 * @returns {string} 合法的 Edge Neural Voice ID
 */
function resolveEdgeVoiceName(targetLang, overrideVoiceName, edgeVoiceMap) {
  if (typeof overrideVoiceName === 'string' && ALLOWED_EDGE_VOICE_IDS.has(overrideVoiceName.trim())) {
    return overrideVoiceName.trim();
  }
  if (edgeVoiceMap && typeof edgeVoiceMap === 'object') {
    const mapped = edgeVoiceMap[targetLang];
    if (typeof mapped === 'string' && ALLOWED_EDGE_VOICE_IDS.has(mapped.trim())) {
      return mapped.trim();
    }
  }
  return DEFAULT_EDGE_VOICE_MAP[targetLang] || DEFAULT_EDGE_VOICE_MAP['zh-TW'];
}

/**
 * 使用 Microsoft Edge 大聲朗讀神經網路語音合成 MP3 音訊
 * @param {string} text - 待朗讀文字
 * @param {string} voiceName - Edge Neural Voice ID
 * @returns {Promise<{ audioDataUrl: string, voiceUsed: string, byteLength: number }>}
 */
async function synthesizeWithEdgeNeural(text, voiceName) {
  const tts = new MsEdgeTTS({
    connectionTimeoutMs: 12000,
    synthesisTimeoutMs: 25000
  });

  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const safeText = escapeSsmlText(text);
    const { audioStream } = tts.toStream(safeText);

    const chunks = [];
    for await (const chunk of audioStream) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }

    const audioBuffer = Buffer.concat(chunks);
    if (audioBuffer.length < 128) {
      throw new Error('Edge 自然神經語音回傳的音訊資料為空');
    }

    return {
      audioDataUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
      voiceUsed: voiceName,
      byteLength: audioBuffer.length
    };
  } finally {
    // 務必主動關閉 WebSocket 連線，避免常駐程序累積閒置連線
    try {
      tts.close();
    } catch {
      // 忽略關閉連線時的例外
    }
  }
}

/**
 * 使用 Google Gemini 官方 Audio TTS (gemini-2.5-flash-preview-tts) 合成自然語音
 * @param {string} text - 待朗讀文字
 * @param {string} voiceName - 預建聲線名稱 (Kore / Aoede / Puck / Charon / Fenrir / Leda)
 * @param {string} geminiApiKey - Google Gemini API Key
 * @param {Function} fetchImpl - Fetch 實作（支援測試注入）
 * @returns {Promise<{ audioDataUrl: string, voiceUsed: string, byteLength: number }>}
 */
async function synthesizeWithGoogleGemini(text, voiceName, geminiApiKey, fetchImpl) {
  if (!geminiApiKey) {
    const err = new Error('NO_API_KEY');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('執行環境缺少 fetch 函式，無法呼叫 Google Gemini TTS API');
  }

  const resolvedVoice = ALLOWED_GEMINI_VOICE_IDS.has(voiceName) ? voiceName : 'Kore';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text }]
        }
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: resolvedVoice
            }
          }
        }
      }
    })
  });

  if (!response.ok) {
    let errMsg = `Gemini TTS API 錯誤 (${response.status})`;
    try {
      const errText = await response.text();
      const errJson = JSON.parse(errText);
      if (errJson && errJson.error && errJson.error.message) {
        errMsg = errJson.error.message;
      }
    } catch {
      // 忽略非 JSON 錯誤內文
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find((part) => part && part.inlineData && part.inlineData.data);

  if (!audioPart) {
    throw new Error('Gemini TTS 未回傳有效的音訊資料');
  }

  const mimeType = String(audioPart.inlineData.mimeType || 'audio/L16;codec=pcm;rate=24000');
  const rawBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
  if (rawBuffer.length === 0) {
    throw new Error('Gemini TTS 回傳的音訊內容為空');
  }

  // 若回傳格式已經是 WAV 或 MP3 則直接使用；若為原始 Linear PCM (audio/L16) 則封裝 44-byte WAV 標頭
  if (/audio\/(wav|x-wav|mpeg|mp3|ogg)/i.test(mimeType)) {
    const normalizedMime = /mp3|mpeg/i.test(mimeType) ? 'audio/mpeg' : mimeType.split(';')[0].trim();
    return {
      audioDataUrl: `data:${normalizedMime};base64,${rawBuffer.toString('base64')}`,
      voiceUsed: resolvedVoice,
      byteLength: rawBuffer.length
    };
  }

  const sampleRate = parseSampleRateFromMimeType(mimeType);
  const wavBuffer = pcmToWavBuffer(rawBuffer, { sampleRate, channels: 1, bitDepth: 16 });
  return {
    audioDataUrl: `data:audio/wav;base64,${wavBuffer.toString('base64')}`,
    voiceUsed: resolvedVoice,
    byteLength: wavBuffer.length
  };
}

/**
 * 統一語音合成入口函式
 * 根據指定引擎或設定呼叫對應語音服務，失敗時回傳 fallbackToLocal: true 讓前端無縫切換地端語音
 * @param {{ text: string, lang?: string, rate?: number, engine?: string, voiceName?: string, geminiApiKey?: string, fetchImpl?: Function }} params
 * @param {object} [settings] - 目前應用程式設定物件
 * @param {{ fetchImpl?: Function }} [options] - 可選依賴注入（供單元測試使用）
 * @returns {Promise<{ ok: boolean, audioDataUrl?: string, engineUsed?: string, voiceUsed?: string, error?: string, errorCode?: string, fallbackToLocal?: boolean }>}
 */
async function synthesizeSpeech(params, settings = {}, options = {}) {
  const req = params && typeof params === 'object' ? params : {};
  const cfg = settings && typeof settings === 'object' ? settings : {};
  const opts = options && typeof options === 'object' ? options : {};

  const cleanedText = typeof req.text === 'string' ? req.text.trim() : '';
  if (!cleanedText) {
    return {
      ok: false,
      error: '沒有可朗讀的文字內容',
      fallbackToLocal: false
    };
  }

  // 限制單次雲端合成長度以確保回應迅速穩定
  const textToSpeak = cleanedText.length > 3000 ? cleanedText.slice(0, 3000) : cleanedText;
  const engine = (req.engine || cfg.ttsEngine || 'edge-neural').trim();
  const targetLang = resolveTargetLang(req.lang, textToSpeak);

  // 若指定使用系統內建地端語音，通知前端直接透過 window.speechSynthesis 朗讀
  if (engine === 'system-local') {
    return {
      ok: false,
      engineUsed: 'system-local',
      error: '已選擇系統內建地端語音',
      fallbackToLocal: true
    };
  }

  // Google Gemini 官方自然語音模式
  if (engine === 'google-gemini') {
    const apiKey = (req.geminiApiKey || cfg.geminiApiKey || '').trim();
    const voiceName = (req.voiceName || cfg.geminiTtsVoice || 'Kore').trim();
    const fetchImpl = opts.fetchImpl || req.fetchImpl || globalThis.fetch;

    try {
      const result = await synthesizeWithGoogleGemini(textToSpeak, voiceName, apiKey, fetchImpl);
      return {
        ok: true,
        audioDataUrl: result.audioDataUrl,
        engineUsed: 'google-gemini',
        voiceUsed: result.voiceUsed
      };
    } catch (err) {
      const isNoKey = err.message === 'NO_API_KEY' || err.code === 'NO_API_KEY';
      return {
        ok: false,
        engineUsed: 'google-gemini',
        error: isNoKey
          ? '尚未設定 Google Gemini API Key，無法使用 Gemini 自然語音。'
          : (err.message || String(err)),
        errorCode: isNoKey ? 'NO_API_KEY' : 'GEMINI_TTS_ERROR',
        fallbackToLocal: true
      };
    }
  }

  // 預設：Edge 自然神經語音模式 (edge-neural)
  const edgeVoice = resolveEdgeVoiceName(targetLang, req.voiceName, cfg.edgeVoiceMap);
  try {
    const result = await synthesizeWithEdgeNeural(textToSpeak, edgeVoice);
    return {
      ok: true,
      audioDataUrl: result.audioDataUrl,
      engineUsed: 'edge-neural',
      voiceUsed: result.voiceUsed
    };
  } catch (err) {
    return {
      ok: false,
      engineUsed: 'edge-neural',
      error: `Edge 自然神經語音連線失敗：${err.message || String(err)}`,
      errorCode: 'EDGE_TTS_ERROR',
      fallbackToLocal: true
    };
  }
}

module.exports = {
  GEMINI_TTS_MODEL,
  TTS_ENGINES,
  EDGE_VOICES_BY_LANG,
  DEFAULT_EDGE_VOICE_MAP,
  GEMINI_TTS_VOICES,
  getTtsOptions,
  resolveTargetLang,
  resolveEdgeVoiceName,
  escapeSsmlText,
  pcmToWavBuffer,
  parseSampleRateFromMimeType,
  synthesizeWithEdgeNeural,
  synthesizeWithGoogleGemini,
  synthesizeSpeech
};
