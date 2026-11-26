// aiService.js - 桌面版 Smart Screen OCR 核心 AI 服務模組
// 支援 Google Gemini (2.5 / 4.0 / 3.8-flash-lite) 與 OpenAI 相容 API 及自訂模型 ID

'use strict';

// 預設 AI 模型與 OpenAI 預設端點
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

// 桌面版專屬 AI 對話系統提示詞（預設以繁體中文回答）
const DESKTOP_CHAT_SYSTEM_PROMPT = `你是一個整合在桌面版「畫面截圖與文字辨識 (Smart Screen OCR)」應用程式中的智慧助手。
使用者從電腦螢幕截圖中框選並擷取了一段文字（或區域截圖）向你提問。
請預設使用繁體中文回答（除非使用者要求其他語言），回答請清晰、有條理、重點明確。`;

// 局部框選 OCR 專用提示詞
const CROP_OCR_PROMPT = `請精準辨識並擷取這張圖片中的所有文字。
直接輸出辨識出的文字內容（保留原本的換行與段落結構），不要加上任何開場白、引號或解釋。若圖片中完全沒有文字，請簡短描述圖案內容。`;

/**
 * 判斷指定模型所屬的 API 供應商 ('gemini' | 'openai')
 * @param {string} modelId - 實際要呼叫的模型 ID
 * @param {string} selectedOption - 下拉選單選中的選項值（可能為 '__custom__'）
 * @param {string} customProvider - 自訂模型供應商設定 ('auto' | 'gemini' | 'openai')
 * @returns {'gemini' | 'openai'}
 */
function resolveProvider(modelId, selectedOption, customProvider) {
  if (selectedOption === '__custom__' && (customProvider === 'gemini' || customProvider === 'openai')) {
    return customProvider;
  }
  return /^gemini/i.test(modelId || '') ? 'gemini' : 'openai';
}

/**
 * 從原始設定物件解析實際 AI 呼叫所需參數
 * @param {object} rawSettings - 設定儲存器提供的設定物件
 * @returns {{ provider: 'gemini'|'openai', model: string, geminiApiKey: string, openaiApiKey: string, openaiBaseUrl: string }}
 */
function resolveAiConfig(rawSettings) {
  const data = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const selectedOption = (data.geminiModel || DEFAULT_MODEL).trim();
  const customModelId = (data.customModelId || '').trim();
  const model = selectedOption === '__custom__' ? (customModelId || DEFAULT_MODEL) : selectedOption;
  const provider = resolveProvider(model, selectedOption, data.customProvider);
  const rawBaseUrl = (data.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL).trim();
  const openaiBaseUrl = rawBaseUrl.replace(/\/+$/, '') || DEFAULT_OPENAI_BASE_URL;

  return {
    provider,
    model,
    geminiApiKey: (data.geminiApiKey || '').trim(),
    openaiApiKey: (data.openaiApiKey || '').trim(),
    openaiBaseUrl
  };
}

/**
 * 解析 Base64 圖片 Data URL 為 { mimeType, base64Data }
 * @param {string} dataUrl - 例如 data:image/jpeg;base64,...
 * @returns {{ mimeType: string, base64Data: string }}
 */
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('無效的圖片格式');
  }
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('無效的圖片格式');
  }
  return {
    mimeType: match[1],
    base64Data: match[2]
  };
}

/**
 * 建立針對 Gemini 2.5 Flash 最佳化的 GenerationConfig
 * 關閉思考預算 (thinkingBudget: 0) 以大幅加速局部截圖 OCR 回應速度
 * @param {string} model - 模型 ID
 * @returns {object} Gemini generationConfig 物件
 */
function buildFastOcrGenerationConfig(model) {
  const config = {
    temperature: 0.1
  };
  if (/gemini-2\.5-flash/i.test(model || '')) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

/**
 * 從失敗的 API HTTP 回應中萃取可讀錯誤訊息
 * @param {Response} response - Fetch 回應物件
 * @param {string} label - API 來源名稱（例如 'Gemini API' 或 'OpenAI API'）
 * @returns {Promise<string>} 錯誤描述文字
 */
async function extractApiError(response, label) {
  let errText = '';
  try {
    errText = await response.text();
  } catch {
    errText = '';
  }

  let errMsg = `${label} 錯誤 (${response.status})`;
  try {
    const errJson = JSON.parse(errText);
    if (errJson && errJson.error && errJson.error.message) {
      errMsg = errJson.error.message;
    }
  } catch {
    // 非 JSON 錯誤回應時沿用預設狀態碼訊息
  }
  return errMsg;
}

/**
 * 局部框選區域高精準度快速 OCR 文字辨識
 * @param {string} imageDataUrl - 裁切後的圖片 Data URL
 * @param {object} rawSettings - 應用程式設定物件
 * @param {{ fetchImpl?: Function }} [options] - 可選依賴注入（供單元測試傳入 mock fetch）
 * @returns {Promise<{ text: string }>}
 */
async function handleCropOCR(imageDataUrl, rawSettings, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('執行環境缺少 fetch 函式，無法呼叫 AI API');
  }

  const config = resolveAiConfig(rawSettings);

  // OpenAI 或相容 API 路線
  if (config.provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('NO_OPENAI_API_KEY');
    }

    const endpoint = `${config.openaiBaseUrl}/chat/completions`;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: CROP_OCR_PROMPT },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(await extractApiError(response, 'OpenAI API'));
    }

    const data = await response.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    return { text };
  }

  // Google Gemini API 路線
  if (!config.geminiApiKey) {
    throw new Error('NO_API_KEY');
  }

  const { mimeType, base64Data } = parseDataUrl(imageDataUrl);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: CROP_OCR_PROMPT }
          ]
        }
      ],
      generationConfig: buildFastOcrGenerationConfig(config.model)
    })
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response, 'Gemini API'));
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim() || '';
  return { text };
}

/**
 * 懸浮視窗多輪 AI 對話查詢（支援圖片與文字上下文、Gemini 與 OpenAI 相容端點）
 * @param {{ selectedText?: string, croppedImageDataUrl?: string, history?: Array<{ role: string, text: string }>, userPrompt: string }} payload
 * @param {object} rawSettings - 應用程式設定物件
 * @param {{ fetchImpl?: Function }} [options] - 可選依賴注入（供單元測試傳入 mock fetch）
 * @returns {Promise<{ reply: string }>}
 */
async function handleAIChat(payload, rawSettings, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('執行環境缺少 fetch 函式，無法呼叫 AI API');
  }

  const config = resolveAiConfig(rawSettings);
  const {
    selectedText = '',
    croppedImageDataUrl = '',
    history = [],
    userPrompt = ''
  } = payload || {};

  // OpenAI 或相容 API 路線
  if (config.provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('NO_OPENAI_API_KEY');
    }

    const messages = [{ role: 'system', content: DESKTOP_CHAT_SYSTEM_PROMPT }];

    // 組合首輪使用者訊息（附加辨識文字與裁切圖片上下文）
    const buildFirstUserContent = (promptText) => {
      const textPart = selectedText
        ? `【使用者選取的文字】：\n"""\n${selectedText}\n"""\n\n【使用者問題】：\n${promptText}`
        : promptText;
      if (croppedImageDataUrl) {
        return [
          { type: 'text', text: textPart },
          { type: 'image_url', image_url: { url: croppedImageDataUrl } }
        ];
      }
      return textPart;
    };

    if (history.length === 0) {
      messages.push({ role: 'user', content: buildFirstUserContent(userPrompt) });
    } else {
      history.forEach((turn, idx) => {
        const role = turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user';
        messages.push({
          role,
          content: idx === 0 ? buildFirstUserContent(turn.text) : turn.text
        });
      });
      messages.push({ role: 'user', content: userPrompt });
    }

    const endpoint = `${config.openaiBaseUrl}/chat/completions`;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        messages
      })
    });

    if (!response.ok) {
      throw new Error(await extractApiError(response, 'OpenAI API'));
    }

    const data = await response.json();
    const reply = (data?.choices?.[0]?.message?.content || '').trim() || '（無回應內容）';
    return { reply };
  }

  // Google Gemini API 路線
  if (!config.geminiApiKey) {
    throw new Error('NO_API_KEY');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
  const systemInstruction = { parts: [{ text: DESKTOP_CHAT_SYSTEM_PROMPT }] };
  const contents = [];

  // 若有裁切圖片則作為多模態上下文加入首輪對話
  const contextParts = [];
  if (croppedImageDataUrl) {
    try {
      const { mimeType, base64Data } = parseDataUrl(croppedImageDataUrl);
      contextParts.push({ inlineData: { mimeType, data: base64Data } });
    } catch {
      // 圖片格式異常時略過圖片上下文，仍保留文字提問
    }
  }

  if (history.length === 0) {
    const fullFirstPrompt = selectedText
      ? `【使用者選取的文字】：\n"""\n${selectedText}\n"""\n\n【使用者問題】：\n${userPrompt}`
      : userPrompt;
    contextParts.push({ text: fullFirstPrompt });
    contents.push({ role: 'user', parts: contextParts });
  } else {
    history.forEach((turn, idx) => {
      const parts = [];
      if (idx === 0) {
        if (contextParts.length > 0) parts.push(...contextParts);
        const firstText = selectedText
          ? `【使用者選取的文字】：\n"""\n${selectedText}\n"""\n\n【使用者問題】：\n${turn.text}`
          : turn.text;
        parts.push({ text: firstText });
      } else {
        parts.push({ text: turn.text });
      }
      contents.push({
        role: turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user',
        parts
      });
    });

    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });
  }

  const generationConfig = { temperature: 0.3 };
  if (/gemini-2\.5-flash/i.test(config.model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction,
      contents,
      generationConfig
    })
  });

  if (!response.ok) {
    throw new Error(await extractApiError(response, 'Gemini API'));
  }

  const data = await response.json();
  const reply = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim() || '（無回應內容）';
  return { reply };
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DESKTOP_CHAT_SYSTEM_PROMPT,
  resolveProvider,
  resolveAiConfig,
  parseDataUrl,
  buildFastOcrGenerationConfig,
  extractApiError,
  handleCropOCR,
  handleAIChat
};
