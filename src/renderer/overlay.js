// overlay.js - Smart Screen OCR 全螢幕凍結截圖覆蓋層核心互動邏輯

(() => {
  // 預設常數（與主程序 settingsStore.js 保持同步）
  const DEFAULT_SHORTCUT = 'Alt+Shift+S';
  const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
  const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
  const DEFAULT_SPEECH_RATE = 1.0;
  const GEMINI_API_KEY_URL = 'https://aistudio.google.com/app/apikey';

  const DEFAULT_EDGE_VOICE_MAP = {
    'zh-TW': 'zh-TW-HsiaoChenNeural',
    'en-US': 'en-US-JennyNeural',
    'en-GB': 'en-GB-SoniaNeural',
    'ja-JP': 'ja-JP-NanamiNeural',
    'ko-KR': 'ko-KR-SunHiNeural',
    'es-ES': 'es-ES-ElviraNeural',
    'fr-FR': 'fr-FR-DeniseNeural',
    'de-DE': 'de-DE-KatjaNeural'
  };

  const DEFAULT_CUSTOM_THEME = {
    bgPrimary: '#0f172a',
    bgSurface: '#1e293b',
    accentColor: '#38bdf8',
    accentSecondary: '#7c3aed',
    textPrimary: '#f8fafc'
  };

  // 覆蓋層執行期狀態
  let currentScreenshotUrl = '';
  let currentDisplayBounds = null;
  let currentPlatform = '';
  let currentRecognizedText = '';
  let currentCroppedDataUrl = null;
  let currentCroppedBounds = null;
  let chatHistory = [];
  let activeCropReqId = 0;
  let toastTimer = null;

  // 自然語音播放與合成請求控制狀態
  let activeAudio = null;
  let activeSpeakReqId = 0;
  let speakState = 'idle'; // 'idle' | 'loading' | 'speaking'
  let ttsOptionsCache = null;

  // 目前同步的應用程式設定
  let currentSettings = {
    geminiApiKey: '',
    openaiApiKey: '',
    openaiBaseUrl: DEFAULT_OPENAI_BASE_URL,
    geminiModel: DEFAULT_MODEL,
    customModelId: '',
    customProvider: 'auto',
    customShortcut: DEFAULT_SHORTCUT,
    launchAtLogin: false,
    speechRate: DEFAULT_SPEECH_RATE,
    preferredVoiceName: '',
    ttsEngine: 'edge-neural',
    edgeVoiceMap: { ...DEFAULT_EDGE_VOICE_MAP },
    geminiTtsVoice: 'Kore',
    themePreset: 'midnight',
    customTheme: { ...DEFAULT_CUSTOM_THEME }
  };

  // DOM 快捷查詢函式
  const $ = (id) => document.getElementById(id);

  /**
   * 透過共用模組 themeHelper.js 將最新主題配色套用到整個覆蓋層、OCR 卡片與查找翻譯面板
   */
  function applyOverlayTheme(settings) {
    if (window.SmartOcrTheme && typeof window.SmartOcrTheme.applyThemeToDocument === 'function') {
      window.SmartOcrTheme.applyThemeToDocument(settings || currentSettings);
    }
  }

  /**
   * 將鍵盤事件轉換為標準快速鍵字串（例如 "Alt+Shift+S"、"Alt+S"、"F8"）
   */
  function eventToShortcutString(e) {
    const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta']);
    if (modifierKeys.has(e.key)) return null;

    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    let keyName = '';
    if (e.code && e.code.startsWith('Key')) {
      keyName = e.code.slice(3).toUpperCase();
    } else if (e.code && e.code.startsWith('Digit')) {
      keyName = e.code.slice(5);
    } else if (/^F\d{1,2}$/i.test(e.key)) {
      keyName = e.key.toUpperCase();
    } else if (e.key === ' ') {
      keyName = 'Space';
    } else if (e.key && e.key.length === 1) {
      keyName = e.key.toUpperCase();
    } else if (e.key) {
      keyName = e.key;
    }

    if (!keyName) return null;
    const isFunctionKey = /^F\d{1,2}$/i.test(keyName);
    if (!isFunctionKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      return null;
    }

    parts.push(keyName);
    return parts.join('+');
  }

  /**
   * 限制語速在 0.7x ~ 1.5x 之間
   */
  function clampSpeechRate(rate) {
    const num = Number(rate);
    if (!Number.isFinite(num)) return DEFAULT_SPEECH_RATE;
    return Math.min(1.5, Math.max(0.7, Math.round(num * 10) / 10));
  }

  /**
   * 判斷目前選用的模型供應商是否為 OpenAI，並檢查對應 API Key 是否已設定
   */
  function checkActiveApiKey(settings) {
    const selOpt = settings.geminiModel || DEFAULT_MODEL;
    const effModel = selOpt === '__custom__' ? (settings.customModelId || DEFAULT_MODEL) : selOpt;
    const isOpenAI =
      (selOpt === '__custom__' && settings.customProvider === 'openai') ||
      (!(selOpt === '__custom__' && settings.customProvider === 'gemini') && !/^gemini/i.test(effModel));
    const hasKey = isOpenAI ? Boolean(settings.openaiApiKey) : Boolean(settings.geminiApiKey);
    return {
      isOpenAI,
      providerLabel: isOpenAI ? 'OpenAI' : 'Gemini',
      hasKey
    };
  }

  /**
   * 關閉覆蓋層：立即停止語音朗讀並通知主程序關閉覆蓋視窗
   */
  function closeCaptureOverlay() {
    stopSpeaking();
    activeCropReqId++;
    if (window.smartOcrApi && typeof window.smartOcrApi.closeOverlay === 'function') {
      window.smartOcrApi.closeOverlay();
    }
  }

  /**
   * 更新頂部懸浮膠囊狀態列文字與狀態樣式
   */
  function updateStatusBadge(text, state = 'normal') {
    const badge = $('statusBadge');
    const txt = $('statusText');
    const spinner = $('statusSpinner');
    if (!badge || !txt || !spinner) return;

    txt.textContent = text;
    badge.className = `status-badge ${state}`;
    spinner.style.display = state === 'loading' ? 'inline-block' : 'none';
  }

  /**
   * 顯示底部短暫 Toast 通知
   */
  function showToast(msg) {
    const toast = $('toastBox');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 2400);
  }

  /**
   * 複製文字到系統剪貼簿（優先透過 Electron 主程序剪貼簿 API，失敗時自動降級至 Web Clipboard）
   */
  async function copyToClipboard(text) {
    if (window.smartOcrApi && typeof window.smartOcrApi.copyText === 'function') {
      try {
        await window.smartOcrApi.copyText(text);
        return;
      } catch {
        // 降級改用瀏覽器剪貼簿 API
      }
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  /**
   * HTML 跳脫處理以防範 XSS 注入
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 簡易 Markdown 渲染（支援程式碼區塊、行內程式碼、粗體與換行）
   */
  function formatSimpleMarkdown(md) {
    let safe = escapeHtml(md);
    safe = safe.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\n/g, '<br/>');
    return safe;
  }

  // ==================== 語音合成模組（嚴格優先 Google 地端自然語音） ====================

  /**
   * 正規化語系代碼（底線轉連字號並轉小寫）
   */
  function normalizeLang(lang) {
    return (lang || '').replace('_', '-').toLowerCase();
  }

  /**
   * 過濾可用語音清單（中文語系僅保留繁體中文，絕不列出簡體語系）
   */
  function isAllowedVoice(voice) {
    if (!voice) return false;
    const lang = normalizeLang(voice.lang);
    if (lang.startsWith('zh') && lang !== 'zh-tw' && lang !== 'zh-hk' && !lang.includes('hant')) {
      return false;
    }
    return true;
  }

  /**
   * 計算語音下拉選單排序權重：Google + localService === true 排在最第一順位
   */
  function getVoiceRank(voice) {
    const isGoogle = /google/i.test(voice.name || '');
    const isNatural = /natural/i.test(voice.name || '');
    const isLocal = voice.localService === true;

    if (isGoogle && isLocal) return 0;
    if (isGoogle) return 1;
    if (isNatural && isLocal) return 2;
    if (isNatural) return 3;
    if (isLocal) return 4;
    return 5;
  }

  /**
   * 將系統內建語音清單依優先順序排列
   */
  function sortVoicesByPriority(voices) {
    return (voices || [])
      .filter(isAllowedVoice)
      .slice()
      .sort((a, b) => {
        const rankDiff = getVoiceRank(a) - getVoiceRank(b);
        if (rankDiff !== 0) return rankDiff;
        return (a.name || '').localeCompare(b.name || '');
      });
  }

  /**
   * 自動偵測文字朗讀語系（日文 / 韓文 / 繁體中文 / 英文）
   */
  function detectSpeechLang(text) {
    if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP';
    if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR';
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh-TW';
    return 'en-US';
  }

  /**
   * 更新辨識結果卡片中的「發音」按鈕狀態（支援 idle / loading / speaking）
   */
  function updateSpeakButtonState(state) {
    const normalized = state === true ? 'speaking' : state === false ? 'idle' : state || 'idle';
    speakState = normalized;
    const btn = $('speakSelectedBtn');
    if (!btn) return;

    if (normalized === 'loading') {
      btn.textContent = '⏳ 載入語音...';
      btn.classList.add('speaking');
    } else if (normalized === 'speaking') {
      btn.textContent = '⏹️ 停止';
      btn.classList.add('speaking');
    } else {
      btn.textContent = '🔊 發音';
      btn.classList.remove('speaking');
    }
  }

  /**
   * 立即停止目前的語音朗讀（同時中止雲端自然語音 Audio 與系統 SpeechSynthesis）
   */
  function stopSpeaking() {
    activeSpeakReqId++;
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.src = '';
      } catch {
        // 忽略音訊元件釋放例外
      }
      activeAudio = null;
    }
    if (typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.cancel();
    }
    updateSpeakButtonState('idle');
  }

  /**
   * 非同步取得系統 Web Speech API 語音清單（相容初次載入 voiceschanged 延遲）
   */
  function getVoicesAsync() {
    if (typeof window.speechSynthesis === 'undefined') {
      return Promise.resolve([]);
    }
    return new Promise((resolve) => {
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        resolve(voices);
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener('voiceschanged', onChanged);
        resolve(window.speechSynthesis.getVoices() || []);
      };
      const onChanged = () => done();
      window.speechSynthesis.addEventListener('voiceschanged', onChanged);
      setTimeout(done, 400);
    });
  }

  /**
   * 嚴格依規範優先序挑選最佳地端語音：
   * 1. 精準語系 + Google + localService === true
   * 2. 同主語系 + Google + localService === true
   * 3. 精準語系 + Google
   * 4. 同主語系 + Google
   * 5. Natural 自然語音（精準語系 -> 同主語系）
   * 6. 其他同語系地端語音（localService === true -> 任意）
   */
  function pickPreferredGoogleVoice(voices, targetLang, preferredVoiceName = '') {
    const allowed = (voices || []).filter(isAllowedVoice);
    if (allowed.length === 0) return null;

    if (preferredVoiceName) {
      const exactNamed = allowed.find((v) => v.name === preferredVoiceName);
      if (exactNamed) return exactNamed;
    }

    const normTarget = normalizeLang(targetLang);
    const baseLang = normTarget.split('-')[0];
    const isGoogle = (v) => /google/i.test(v.name || '');
    const isNatural = (v) => /natural/i.test(v.name || '');
    const isLocal = (v) => v.localService === true;
    const voiceLang = (v) => normalizeLang(v.lang);

    return (
      allowed.find((v) => isGoogle(v) && isLocal(v) && voiceLang(v) === normTarget) ||
      allowed.find((v) => isGoogle(v) && isLocal(v) && voiceLang(v).startsWith(baseLang)) ||
      allowed.find((v) => isGoogle(v) && voiceLang(v) === normTarget) ||
      allowed.find((v) => isGoogle(v) && voiceLang(v).startsWith(baseLang)) ||
      allowed.find((v) => isNatural(v) && voiceLang(v) === normTarget) ||
      allowed.find((v) => isNatural(v) && voiceLang(v).startsWith(baseLang)) ||
      allowed.find((v) => isLocal(v) && voiceLang(v) === normTarget) ||
      allowed.find((v) => isLocal(v) && voiceLang(v).startsWith(baseLang)) ||
      allowed.find((v) => voiceLang(v) === normTarget) ||
      allowed.find((v) => voiceLang(v).startsWith(baseLang)) ||
      null
    );
  }

  /**
   * 格式化語音下拉選單顯示名稱
   */
  function formatVoiceOptionLabel(voice) {
    const isGoogle = /google/i.test(voice.name || '');
    const isNatural = /natural/i.test(voice.name || '');
    const isLocal = voice.localService === true;

    if (isGoogle && isLocal) return `⭐ [Google 地端] ${voice.name} (${voice.lang})`;
    if (isGoogle) return `✨ [Google] ${voice.name} (${voice.lang})`;
    if (isNatural && isLocal) return `🌿 [自然地端] ${voice.name} (${voice.lang})`;
    if (isNatural) return `🌿 [自然語音] ${voice.name} (${voice.lang})`;
    if (isLocal) return `💻 [地端] ${voice.name} (${voice.lang})`;
    return `${voice.name} (${voice.lang})`;
  }

  /**
   * 從主程序載入自然語音引擎與聲線清單（快取使用）
   */
  async function loadTtsOptions() {
    if (ttsOptionsCache) return ttsOptionsCache;
    if (window.smartOcrApi && typeof window.smartOcrApi.getTtsOptions === 'function') {
      try {
        ttsOptionsCache = await window.smartOcrApi.getTtsOptions();
      } catch {
        ttsOptionsCache = null;
      }
    }
    return ttsOptionsCache;
  }

  /**
   * 依指定語音引擎填入對應的聲線選項（Edge 神經語音 / Google Gemini / 系統 Google 地端語音）
   */
  async function fillVoiceSelectForEngine(selectEl, engine, preferredValue) {
    if (!selectEl) return;
    selectEl.innerHTML = '';

    if (engine === 'edge-neural') {
      const autoOpt = document.createElement('option');
      autoOpt.value = '';
      autoOpt.textContent = '⭐ 自動配對 Edge 神經聲線（依內容語系）';
      selectEl.appendChild(autoOpt);

      const opts = await loadTtsOptions();
      const edgeItems = [];
      if (opts && opts.edgeVoicesByLang) {
        Object.entries(opts.edgeVoicesByLang).forEach(([lang, list]) => {
          if (Array.isArray(list)) {
            list.forEach((v) => {
              const id = v.id || v.value || v.name || v;
              const label = v.label || v.name || id;
              edgeItems.push({ value: id, label: `${label} (${lang})` });
            });
          }
        });
      } else {
        edgeItems.push(
          { value: 'zh-TW-HsiaoChenNeural', label: '台灣女聲・曉臻 (zh-TW)' },
          { value: 'zh-TW-YunJheNeural', label: '台灣男聲・雲哲 (zh-TW)' },
          { value: 'zh-TW-HsiaoYuNeural', label: '台灣女聲・曉雨 (zh-TW)' },
          { value: 'en-US-JennyNeural', label: 'Jenny 自然女聲 (en-US)' },
          { value: 'en-US-GuyNeural', label: 'Guy 自然男聲 (en-US)' },
          { value: 'en-US-AriaNeural', label: 'Aria 清新女聲 (en-US)' }
        );
      }
      edgeItems.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.value;
        opt.textContent = item.label;
        selectEl.appendChild(opt);
      });
      const hasVal = Array.from(selectEl.options).some((o) => o.value === preferredValue);
      selectEl.value = hasVal ? preferredValue : '';
      return;
    }

    if (engine === 'google-gemini') {
      const opts = await loadTtsOptions();
      const geminiList = (opts && Array.isArray(opts.geminiVoices) && opts.geminiVoices.length > 0)
        ? opts.geminiVoices.map((v) => ({
            value: v.id || v.value || v.name || v,
            label: v.label || v.name || v
          }))
        : [
            { value: 'Kore', label: 'Kore（沉穩清晰）' },
            { value: 'Aoede', label: 'Aoede（溫潤自然）' },
            { value: 'Puck', label: 'Puck（輕快活潑）' },
            { value: 'Charon', label: 'Charon（低沉磁性）' },
            { value: 'Fenrir', label: 'Fenrir（厚實穩重）' },
            { value: 'Leda', label: 'Leda（柔和親切）' }
          ];

      geminiList.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.value;
        opt.textContent = `✨ ${item.label}`;
        selectEl.appendChild(opt);
      });
      const targetVoice = preferredValue || currentSettings.geminiTtsVoice || 'Kore';
      const hasVal = Array.from(selectEl.options).some((o) => o.value === targetVoice);
      selectEl.value = hasVal ? targetVoice : 'Kore';
      return;
    }

    // system-local：優先將 Google + localService === true 排在最前方
    const voices = await getVoicesAsync();
    const sorted = sortVoicesByPriority(voices);
    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = '⭐ 自動最佳 Google 地端語音';
    selectEl.appendChild(autoOpt);

    sorted.forEach((voice) => {
      const opt = document.createElement('option');
      opt.value = voice.name;
      opt.textContent = formatVoiceOptionLabel(voice);
      selectEl.appendChild(opt);
    });

    const targetLocal = preferredValue || currentSettings.preferredVoiceName || '';
    const hasMatch = Array.from(selectEl.options).some((opt) => opt.value === targetLocal);
    selectEl.value = hasMatch ? targetLocal : '';
  }

  /**
   * 同步更新辨識卡片與設定 Modal 內的語音引擎與聲線下拉選單
   */
  async function populateVoiceSelects() {
    const cardEngine = $('cardTtsEngineSelect')?.value || currentSettings.ttsEngine || 'edge-neural';
    const modalEngine = $('modalTtsEngineSelect')?.value || currentSettings.ttsEngine || 'edge-neural';

    const cardPref = cardEngine === 'google-gemini'
      ? currentSettings.geminiTtsVoice
      : cardEngine === 'system-local'
        ? currentSettings.preferredVoiceName
        : '';

    const modalPref = modalEngine === 'google-gemini'
      ? currentSettings.geminiTtsVoice
      : modalEngine === 'system-local'
        ? currentSettings.preferredVoiceName
        : '';

    await Promise.all([
      fillVoiceSelectForEngine($('cardVoiceSelect'), cardEngine, cardPref),
      fillVoiceSelectForEngine($('modalVoiceSelect'), modalEngine, modalPref)
    ]);
  }

  /**
   * 使用系統內建 SpeechSynthesis 朗讀（嚴格優先 Google 地端語音 localService === true）
   */
  async function speakWithSystemLocal(text, targetLang, rate, reqId) {
    if (typeof window.speechSynthesis === 'undefined') {
      showToast('⚠️ 目前環境不支援語音朗讀功能');
      updateSpeakButtonState('idle');
      return;
    }
    window.speechSynthesis.cancel();

    const voices = await getVoicesAsync();
    if (reqId !== activeSpeakReqId) return;

    const cardEngine = $('cardTtsEngineSelect')?.value || currentSettings.ttsEngine;
    const selectedLocalName = cardEngine === 'system-local'
      ? ($('cardVoiceSelect')?.value || currentSettings.preferredVoiceName)
      : currentSettings.preferredVoiceName;

    const chosenVoice = pickPreferredGoogleVoice(voices, targetLang, selectedLocalName);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = chosenVoice ? chosenVoice.lang : targetLang;
    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }
    utterance.rate = rate;

    utterance.onstart = () => {
      if (reqId === activeSpeakReqId) updateSpeakButtonState('speaking');
    };
    utterance.onend = () => {
      if (reqId === activeSpeakReqId) updateSpeakButtonState('idle');
    };
    utterance.onerror = () => {
      if (reqId === activeSpeakReqId) updateSpeakButtonState('idle');
    };

    updateSpeakButtonState('speaking');
    window.speechSynthesis.speak(utterance);
  }

  /**
   * 朗讀指定文字：依使用者設定優先呼叫 Edge 自然神經語音 / Google Gemini 官方語音，
   * 離線或失敗時自動平滑備援至系統內建 Google 地端語音（絕不靜默失靈）
   */
  async function speakText(text) {
    stopSpeaking();
    const reqId = ++activeSpeakReqId;

    const targetLang = detectSpeechLang(text);
    const engine = $('cardTtsEngineSelect')?.value || currentSettings.ttsEngine || 'edge-neural';
    const rate = clampSpeechRate($('cardSpeechRateSelect')?.value || currentSettings.speechRate);

    // 若選擇系統地端語音，直接走 window.speechSynthesis（Google 地端優先）
    if (engine === 'system-local') {
      await speakWithSystemLocal(text, targetLang, rate, reqId);
      return;
    }

    // 確認主程序自然語音合成服務可用，否則提示並自動備援地端語音
    if (!window.smartOcrApi || typeof window.smartOcrApi.synthesizeSpeech !== 'function') {
      showToast('⚠️ 無法連接自然語音服務，已切換系統地端語音');
      await speakWithSystemLocal(text, targetLang, rate, reqId);
      return;
    }

    // 決定此次朗讀使用的聲線名稱
    const explicitVoice = $('cardVoiceSelect')?.value || '';
    let voiceName = explicitVoice;
    if (!voiceName) {
      if (engine === 'edge-neural') {
        voiceName = (currentSettings.edgeVoiceMap && currentSettings.edgeVoiceMap[targetLang]) || '';
      } else if (engine === 'google-gemini') {
        voiceName = currentSettings.geminiTtsVoice || 'Kore';
      }
    }

    updateSpeakButtonState('loading');

    try {
      const res = await window.smartOcrApi.synthesizeSpeech({
        text,
        lang: targetLang,
        rate,
        engine,
        voiceName
      });

      // 若等待合成期間使用者已停止或關閉覆蓋層，立刻放棄播放
      if (reqId !== activeSpeakReqId) return;

      if (res && res.ok && res.audioDataUrl) {
        const audio = new Audio(res.audioDataUrl);
        audio.playbackRate = rate;
        activeAudio = audio;

        audio.onplay = () => {
          if (reqId === activeSpeakReqId) updateSpeakButtonState('speaking');
        };
        audio.onended = () => {
          if (reqId === activeSpeakReqId) {
            activeAudio = null;
            updateSpeakButtonState('idle');
          }
        };
        audio.onerror = async () => {
          if (reqId !== activeSpeakReqId) return;
          activeAudio = null;
          showToast('⚠️ 自然語音音訊播放失敗，已自動切換系統地端語音');
          await speakWithSystemLocal(text, targetLang, rate, reqId);
        };

        updateSpeakButtonState('speaking');
        await audio.play();
        return;
      }

      const engineLabel = engine === 'google-gemini' ? 'Gemini 語音' : 'Edge 自然語音';
      const errReason = res?.error || '服務暫時無法使用';
      showToast(`⚠️ ${engineLabel} 失敗（${errReason}），已自動切換系統地端語音`);
      await speakWithSystemLocal(text, targetLang, rate, reqId);
    } catch (err) {
      if (reqId !== activeSpeakReqId) return;
      showToast(`⚠️ 語音合成異常（${err.message}），已自動切換系統地端語音`);
      await speakWithSystemLocal(text, targetLang, rate, reqId);
    }
  }

  // ==================== 框選裁切、High-DPI 對齊與無色偏存圖 ====================

  /**
   * 取得辨識結果文字框的目標文字：若有反白選取局部字詞則回傳反白文字，否則回傳全文
   */
  function getTargetTextFromCard() {
    const area = $('ocrResultTextarea');
    if (!area) return currentRecognizedText.trim();
    const selStart = area.selectionStart;
    const selEnd = area.selectionEnd;
    if (typeof selStart === 'number' && typeof selEnd === 'number' && selEnd > selStart) {
      const sub = area.value.substring(selStart, selEnd).trim();
      if (sub) return sub;
    }
    return area.value.trim();
  }

  /**
   * 計算並定位辨識結果卡片位置，避免超出螢幕可視範圍
   */
  function positionResultCardNearBox(left, top, width, height) {
    const card = $('ocrResultCard');
    if (!card) return;
    card.style.display = 'flex';

    const cardWidth = Math.min(430, window.innerWidth - 32);
    const estimatedCardHeight = 220;

    const clampedLeft = Math.max(
      16,
      Math.min(window.innerWidth - cardWidth - 16, left + width / 2 - cardWidth / 2)
    );

    let targetTop = top + height + 12;
    if (targetTop + estimatedCardHeight > window.innerHeight - 12) {
      targetTop = Math.max(68, top - estimatedCardHeight - 12);
    }

    card.style.left = `${clampedLeft}px`;
    card.style.top = `${targetTop}px`;
  }

  /**
   * 以不經色彩空間轉換的方式解碼截圖 Data URL，避免廣色域螢幕 ICC 導致存檔色偏
   */
  async function decodeScreenshotRaw(dataUrl) {
    if (typeof createImageBitmap === 'function') {
      try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          cleanup: () => bitmap.close()
        };
      } catch {
        // 若 createImageBitmap 不支援 colorSpaceConversion，自動降級為 Image 物件
      }
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          cleanup: () => {}
        });
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * 精準計算 High-DPI 螢幕裁切座標（以 img.naturalWidth / window.innerWidth 等比例對齊）
   */
  function computeHighDpiCropRect(naturalWidth, naturalHeight, left, top, width, height) {
    const scaleX = naturalWidth / Math.max(1, window.innerWidth);
    const scaleY = naturalHeight / Math.max(1, window.innerHeight);

    const sx = Math.max(0, Math.min(naturalWidth - 1, Math.round(left * scaleX)));
    const sy = Math.max(0, Math.min(naturalHeight - 1, Math.round(top * scaleY)));
    const sw = Math.max(1, Math.min(naturalWidth - sx, Math.round(width * scaleX)));
    const sh = Math.max(1, Math.min(naturalHeight - sy, Math.round(height * scaleY)));

    return { sx, sy, sw, sh };
  }

  /**
   * 將凍結截圖的指定框選區域裁切並壓縮為高品質 JPEG Data URL（供 AI OCR 辨識使用）
   */
  function cropScreenshotRegion(left, top, width, height) {
    return new Promise((resolve) => {
      if (!currentScreenshotUrl) {
        resolve(null);
        return;
      }

      const img = new Image();
      img.onload = () => {
        const scaleX = img.naturalWidth / Math.max(1, window.innerWidth);
        const scaleY = img.naturalHeight / Math.max(1, window.innerHeight);

        const sx = Math.max(0, Math.min(img.naturalWidth - 1, Math.round(left * scaleX)));
        const sy = Math.max(0, Math.min(img.naturalHeight - 1, Math.round(top * scaleY)));
        const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(width * scaleX)));
        const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(height * scaleY)));

        const maxDim = 1600;
        let outW = sw;
        let outH = sh;
        if (outW > maxDim || outH > maxDim) {
          const ratio = Math.min(maxDim / outW, maxDim / outH);
          outW = Math.max(1, Math.round(outW * ratio));
          outH = Math.max(1, Math.round(outH * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d', { colorSpace: 'srgb', alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => resolve(null);
      img.src = currentScreenshotUrl;
    });
  }

  /**
   * 將框選區域以原始高畫質無色偏像素另存為 JPG（呼叫系統原生另存新檔對話框）
   */
  async function saveCroppedRegionAsImage() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const defaultFileName = `smart-capture-${stamp}.jpg`;

    let exportDataUrl = currentCroppedDataUrl;

    if (currentCroppedBounds && currentScreenshotUrl) {
      try {
        const decoded = await decodeScreenshotRaw(currentScreenshotUrl);
        const { left, top, width, height } = currentCroppedBounds;
        const { sx, sy, sw, sh } = computeHighDpiCropRect(
          decoded.width,
          decoded.height,
          left,
          top,
          width,
          height
        );

        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d', { colorSpace: 'srgb', alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sw, sh);
        ctx.drawImage(decoded.source, sx, sy, sw, sh, 0, 0, sw, sh);
        decoded.cleanup();

        exportDataUrl = canvas.toDataURL('image/jpeg', 0.95);
      } catch {
        // 若原始解碼失敗，沿用既有的裁切結果 Data URL
      }
    }

    if (!exportDataUrl) {
      showToast('⚠️ 尚無可儲存的框選圖片');
      return;
    }

    if (!window.smartOcrApi || typeof window.smartOcrApi.saveImage !== 'function') {
      showToast('⚠️ 系統原生儲存服務未就緒');
      return;
    }

    try {
      const res = await window.smartOcrApi.saveImage({
        dataUrl: exportDataUrl,
        defaultFileName
      });
      if (res && res.canceled) {
        return;
      }
      if (res && res.ok) {
        showToast('✅ 已將框選區域另存為高畫質 JPG 圖片！');
      } else {
        showToast(`⚠️ 另存圖片失敗：${res?.error || '未知錯誤'}`);
      }
    } catch (err) {
      showToast(`⚠️ 另存圖片發生錯誤：${err.message}`);
    }
  }

  // ==================== AI 局部 OCR 辨識與 Gemini 多輪對話 ====================

  /**
   * 呼叫主程序 AI 服務對框選局部圖片執行 OCR 文字辨識
   */
  async function performRegionOCR(croppedDataUrl) {
    const reqId = ++activeCropReqId;
    const marquee = $('marqueeBox');
    const textarea = $('ocrResultTextarea');
    const title = $('ocrCardTitle');

    marquee.classList.add('scanning');
    textarea.value = '';
    textarea.placeholder = '✨ AI 正在極速辨識框選區域文字...';
    title.textContent = '⏳ 正在辨識選取區域...';
    updateStatusBadge('🔍 正在辨識框選區域文字...', 'loading');

    if (!window.smartOcrApi || typeof window.smartOcrApi.ocrCrop !== 'function') {
      marquee.classList.remove('scanning');
      textarea.placeholder = '無法連接桌面 OCR 辨識服務';
      updateStatusBadge('⚠️ 無法連接桌面 OCR 辨識服務', 'warn');
      return;
    }

    try {
      const res = await window.smartOcrApi.ocrCrop(croppedDataUrl);
      if (reqId !== activeCropReqId) return;
      marquee.classList.remove('scanning');

      if (!res || !res.ok) {
        const errMsg = res?.error || '未知錯誤';
        if (errMsg === 'NO_API_KEY' || errMsg === 'NO_OPENAI_API_KEY') {
          const providerLabel = errMsg === 'NO_OPENAI_API_KEY' ? 'OpenAI' : 'Gemini';
          textarea.placeholder = `請先設定 ${providerLabel} API Key`;
          title.textContent = `⚠️ 尚未設定 ${providerLabel} API Key`;
          updateStatusBadge(`⚠️ 請先設定 ${providerLabel} API Key`, 'warn');
          openSettingsModal();
          return;
        }
        textarea.placeholder = `辨識失敗：${errMsg}`;
        title.textContent = '⚠️ 辨識失敗，請點選重試';
        updateStatusBadge(`⚠️ 辨識失敗：${errMsg}`, 'warn');
        return;
      }

      const recognized = (res.data?.text || '').trim();
      currentRecognizedText = recognized;
      textarea.value = recognized;
      textarea.placeholder = '（此區域未偵測到文字）';
      title.textContent = '✅ 辨識完成（可直接反白選取部分字詞，或直接點擊下方按鈕）';
      updateStatusBadge(
        `✅ 框選區域辨識完成！可再次拖曳框選其他區域（快速鍵：${currentSettings.customShortcut || DEFAULT_SHORTCUT}）`,
        'normal'
      );
    } catch (err) {
      if (reqId !== activeCropReqId) return;
      marquee.classList.remove('scanning');
      textarea.placeholder = `發生錯誤：${err.message}`;
      title.textContent = '⚠️ 辨識發生例外錯誤';
      updateStatusBadge(`⚠️ 發生錯誤：${err.message}`, 'warn');
    }
  }

  /**
   * 開啟可拖曳的 Gemini 懸浮對話視窗並載入上下文文字
   */
  function openGeminiPanelWithText(text, initialPrompt) {
    const panel = $('geminiPanel');
    panel.style.display = 'flex';

    const cleanText = (text || '').trim();
    $('contextTextarea').value = cleanText;
    $('chatInput').value = '';
    chatHistory = [];
    $('chatMessages').innerHTML = '';

    if (initialPrompt) {
      sendChatMessage(initialPrompt);
    }
  }

  /**
   * 新增一則使用者或 AI 對話泡泡至對話紀錄容器
   */
  function appendChatBubble(role, text) {
    const container = $('chatMessages');
    const div = document.createElement('div');
    div.className = `msg-bubble ${role === 'user' ? 'msg-user' : 'msg-model'}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  /**
   * 將 AI 回應以安全 Markdown 渲染至氣泡並掛載一鍵複製回答按鈕
   */
  function renderModelBubbleContent(bubbleEl, markdownText) {
    const html = formatSimpleMarkdown(markdownText);
    bubbleEl.innerHTML = `
      <div class="md-body">${html}</div>
      <div class="msg-actions">
        <button class="copy-reply-btn" type="button">📋 複製回答</button>
      </div>
    `;
    const copyBtn = bubbleEl.querySelector('.copy-reply-btn');
    copyBtn.addEventListener('click', async () => {
      await copyToClipboard(markdownText);
      showToast('✅ 已複製 AI 回答！');
    });
    const container = $('chatMessages');
    container.scrollTop = container.scrollHeight;
  }

  /**
   * 傳送多輪追問訊息給 AI 服務並顯示回應
   */
  async function sendChatMessage(userPrompt) {
    const selectedText = $('contextTextarea').value.trim();

    appendChatBubble('user', userPrompt);
    const loadingBubble = appendChatBubble('model', '✨ AI 思考中...');
    $('sendChatBtn').disabled = true;

    if (!window.smartOcrApi || typeof window.smartOcrApi.aiChat !== 'function') {
      $('sendChatBtn').disabled = false;
      loadingBubble.innerHTML = '⚠️ 無法連接桌面 AI 對話服務';
      return;
    }

    try {
      const res = await window.smartOcrApi.aiChat({
        selectedText,
        croppedImageDataUrl: currentCroppedDataUrl,
        history: chatHistory,
        userPrompt
      });

      $('sendChatBtn').disabled = false;

      if (!res || !res.ok) {
        if (res?.error === 'NO_API_KEY' || res?.error === 'NO_OPENAI_API_KEY') {
          const providerLabel = res.error === 'NO_OPENAI_API_KEY' ? 'OpenAI' : 'Gemini';
          loadingBubble.innerHTML = `⚠️ 請先點擊上方「⚙️ 設定」填入 ${providerLabel} API Key。`;
          openSettingsModal();
          return;
        }
        loadingBubble.innerHTML = `⚠️ 錯誤：${escapeHtml(res?.error || '無法取得回應')}`;
        return;
      }

      const reply = res.data?.reply || '';
      chatHistory.push({ role: 'user', text: userPrompt });
      chatHistory.push({ role: 'model', text: reply });

      renderModelBubbleContent(loadingBubble, reply);
    } catch (err) {
      $('sendChatBtn').disabled = false;
      loadingBubble.innerHTML = `⚠️ 發生錯誤：${escapeHtml(err.message)}`;
    }
  }

  // ==================== 滑鼠框選、拖曳面板與設定 Modal 管理 ====================

  /**
   * 啟用滑鼠左鍵拖曳框選（Rubber-band Marquee），放開滑鼠後立即裁切並辨識
   */
  function setupMarqueeSelection() {
    const canvas = $('interactionCanvas');
    const marquee = $('marqueeBox');
    const resultCard = $('ocrResultCard');
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      stopSpeaking();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      resultCard.style.display = 'none';
      marquee.classList.remove('scanning');
      marquee.style.left = `${startX}px`;
      marquee.style.top = `${startY}px`;
      marquee.style.width = '0px';
      marquee.style.height = '0px';
      marquee.style.display = 'block';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const curX = e.clientX;
      const curY = e.clientY;
      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      marquee.style.left = `${left}px`;
      marquee.style.top = `${top}px`;
      marquee.style.width = `${width}px`;
      marquee.style.height = `${height}px`;
    });

    window.addEventListener('mouseup', async (e) => {
      if (!isDragging) return;
      isDragging = false;

      const endX = e.clientX;
      const endY = e.clientY;
      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);

      // 忽略極小誤觸點擊
      if (width < 14 || height < 14) {
        marquee.style.display = 'none';
        return;
      }

      positionResultCardNearBox(left, top, width, height);

      currentCroppedBounds = { left, top, width, height };
      currentCroppedDataUrl = await cropScreenshotRegion(left, top, width, height);
      if (currentCroppedDataUrl) {
        await performRegionOCR(currentCroppedDataUrl);
      } else {
        updateStatusBadge('⚠️ 截圖裁切失敗，請重新嘗試', 'warn');
      }
    });
  }

  /**
   * 讓 Gemini 懸浮對話視窗可按住標題列自由拖曳移動
   */
  function setupDraggablePanel(panel, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, e.clientX - offsetX));
      const top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, e.clientY - offsetY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  /**
   * 將最新設定同步套用到覆蓋層快取、全域連動配色與語音控制列
   */
  function applySettingsToOverlay(settings) {
    if (!settings) return;
    currentSettings = {
      ...currentSettings,
      ...settings,
      edgeVoiceMap: {
        ...DEFAULT_EDGE_VOICE_MAP,
        ...(currentSettings.edgeVoiceMap || {}),
        ...(settings.edgeVoiceMap || {})
      },
      customTheme: {
        ...DEFAULT_CUSTOM_THEME,
        ...(currentSettings.customTheme || {}),
        ...(settings.customTheme || {})
      }
    };

    // 立即套用連動配色主題至覆蓋層光暈、OCR 卡片與查找翻譯面板
    applyOverlayTheme(currentSettings);

    const safeRate = String(clampSpeechRate(currentSettings.speechRate));
    if ($('cardSpeechRateSelect')) $('cardSpeechRateSelect').value = safeRate;
    if ($('modalSpeechRateSelect')) $('modalSpeechRateSelect').value = safeRate;

    const engine = currentSettings.ttsEngine || 'edge-neural';
    if ($('cardTtsEngineSelect')) $('cardTtsEngineSelect').value = engine;
    if ($('modalTtsEngineSelect')) $('modalTtsEngineSelect').value = engine;

    if ($('modalThemePresetSelect')) {
      const preset = currentSettings.themePreset || 'midnight';
      const hasPreset = Array.from($('modalThemePresetSelect').options).some((o) => o.value === preset);
      $('modalThemePresetSelect').value = hasPreset ? preset : 'midnight';
    }

    populateVoiceSelects();
  }

  /**
   * 開啟覆蓋層內建設定 Modal 並載入最新設定值
   */
  async function openSettingsModal() {
    if (window.smartOcrApi && typeof window.smartOcrApi.getSettings === 'function') {
      try {
        const latest = await window.smartOcrApi.getSettings();
        applySettingsToOverlay(latest);
      } catch {
        // 使用記憶體快取設定
      }
    }

    $('apiKeyInput').value = currentSettings.geminiApiKey || '';
    $('openaiApiKeyInput').value = currentSettings.openaiApiKey || '';
    $('openaiBaseUrlInput').value = currentSettings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL;

    const selectEl = $('modelSelect');
    const savedModel = currentSettings.geminiModel || DEFAULT_MODEL;
    const hasOption = Array.from(selectEl.options).some((opt) => opt.value === savedModel);
    if (hasOption) {
      selectEl.value = savedModel;
      $('customModelIdInput').value = currentSettings.customModelId || '';
    } else {
      selectEl.value = '__custom__';
      $('customModelIdInput').value = currentSettings.customModelId || savedModel;
    }
    $('customProviderSelect').value = currentSettings.customProvider || 'auto';
    $('customModelBox').style.display = selectEl.value === '__custom__' ? 'block' : 'none';

    const shortcut = currentSettings.customShortcut || DEFAULT_SHORTCUT;
    $('shortcutInput').value = shortcut;
    $('shortcutInput').dataset.prev = shortcut;
    $('modalShortcutWarn').style.display = 'none';
    $('modalShortcutWarn').textContent = '';

    $('modalThemePresetSelect').value = currentSettings.themePreset || 'midnight';
    $('modalTtsEngineSelect').value = currentSettings.ttsEngine || 'edge-neural';
    await populateVoiceSelects();
    $('modalSpeechRateSelect').value = String(clampSpeechRate(currentSettings.speechRate));
    $('settingsModal').style.display = 'flex';
  }

  /**
   * 關閉設定 Modal 並還原未儲存的暫時配色預覽
   */
  function closeSettingsModalAndRestoreTheme() {
    $('settingsModal').style.display = 'none';
    applyOverlayTheme(currentSettings);
  }

  /**
   * 收到主程序傳送的 overlay:init 資料時，重置畫面狀態、套用主題配色並顯示最新凍結截圖
   */
  function initOverlayState(payload) {
    stopSpeaking();
    activeCropReqId++;
    currentRecognizedText = '';
    currentCroppedDataUrl = null;
    currentCroppedBounds = null;
    chatHistory = [];

    currentScreenshotUrl = payload?.screenshotDataUrl || '';
    currentDisplayBounds = payload?.displayBounds || null;
    currentPlatform = payload?.platform || '';

    const imgEl = $('screenshotImg');
    if (imgEl && currentScreenshotUrl) {
      imgEl.src = currentScreenshotUrl;
    }

    // 隱藏前一次殘留的卡片與面板
    $('marqueeBox').style.display = 'none';
    $('marqueeBox').classList.remove('scanning');
    $('ocrResultCard').style.display = 'none';
    $('geminiPanel').style.display = 'none';
    $('settingsModal').style.display = 'none';

    if (payload?.settings) {
      applySettingsToOverlay(payload.settings);
    } else {
      applyOverlayTheme(currentSettings);
      populateVoiceSelects();
    }

    // 檢查目前選用供應商是否已有 API Key
    const { providerLabel, hasKey } = checkActiveApiKey(currentSettings);
    const shortcutLabel = currentSettings.customShortcut || DEFAULT_SHORTCUT;

    if (!hasKey) {
      updateStatusBadge(`⚠️ 請先設定 ${providerLabel} API Key 與全域快速鍵`, 'warn');
      openSettingsModal();
    } else {
      updateStatusBadge(
        `✨ 請按住滑鼠左鍵「拖曳框選」要辨識文字的區域（快速鍵：${shortcutLabel}｜按 Esc 或 ✕ 關閉）`,
        'normal'
      );
    }
  }

  /**
   * 綁定覆蓋層所有按鈕、快捷鍵與互動事件
   */
  function bindOverlayEvents() {
    // 右上角關閉按鈕 (✕)
    $('closeOverlayBtn').addEventListener('click', closeCaptureOverlay);

    // 頂部「設定 / 配色」與「主視窗」按鈕
    $('openSettingsBtn').addEventListener('click', openSettingsModal);
    $('openFullSettingsBtn').addEventListener('click', () => {
      if (window.smartOcrApi && typeof window.smartOcrApi.openSettingsWindow === 'function') {
        window.smartOcrApi.openSettingsWindow();
      }
      closeCaptureOverlay();
    });

    // 關閉設定 Modal（未儲存時還原原本主題配色）
    $('closeSettingsModalBtn').addEventListener('click', closeSettingsModalAndRestoreTheme);
    $('cancelSettingsBtn').addEventListener('click', closeSettingsModalAndRestoreTheme);

    // 覆蓋層設定 Modal 內即時切換連動配色主題預覽
    $('modalThemePresetSelect').addEventListener('change', () => {
      applyOverlayTheme({
        ...currentSettings,
        themePreset: $('modalThemePresetSelect').value
      });
    });

    // 外部連結改由系統瀏覽器開啟
    $('getGeminiKeyLink').addEventListener('click', (e) => {
      e.preventDefault();
      if (window.smartOcrApi && typeof window.smartOcrApi.openExternalUrl === 'function') {
        window.smartOcrApi.openExternalUrl(GEMINI_API_KEY_URL);
      }
    });

    // 全域快速鍵錄製框
    const shortcutInput = $('shortcutInput');
    shortcutInput.addEventListener('focus', () => {
      shortcutInput.dataset.prev = shortcutInput.value;
      shortcutInput.value = '請直接按下鍵盤組合鍵 (例如 Alt+Shift+S)...';
    });
    shortcutInput.addEventListener('blur', () => {
      if (shortcutInput.value.startsWith('請直接按下')) {
        shortcutInput.value = shortcutInput.dataset.prev || currentSettings.customShortcut || DEFAULT_SHORTCUT;
      }
    });
    shortcutInput.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        shortcutInput.value = shortcutInput.dataset.prev || currentSettings.customShortcut || DEFAULT_SHORTCUT;
        shortcutInput.blur();
        return;
      }
      const combo = eventToShortcutString(e);
      if (combo) {
        shortcutInput.value = combo;
        shortcutInput.dataset.prev = combo;
        shortcutInput.blur();
      }
    });

    $('resetShortcutBtn').addEventListener('click', () => {
      shortcutInput.value = DEFAULT_SHORTCUT;
      shortcutInput.dataset.prev = DEFAULT_SHORTCUT;
    });

    $('modelSelect').addEventListener('change', () => {
      $('customModelBox').style.display = $('modelSelect').value === '__custom__' ? 'block' : 'none';
    });

    // 辨識結果卡片內的語音引擎、聲線與語速即時調整
    $('cardTtsEngineSelect').addEventListener('change', async () => {
      stopSpeaking();
      const engine = $('cardTtsEngineSelect').value;
      currentSettings.ttsEngine = engine;
      if ($('modalTtsEngineSelect')) $('modalTtsEngineSelect').value = engine;
      await populateVoiceSelects();
    });

    $('modalTtsEngineSelect').addEventListener('change', async () => {
      const engine = $('modalTtsEngineSelect').value;
      await fillVoiceSelectForEngine(
        $('modalVoiceSelect'),
        engine,
        engine === 'google-gemini'
          ? currentSettings.geminiTtsVoice
          : engine === 'system-local'
            ? currentSettings.preferredVoiceName
            : ''
      );
    });

    $('cardVoiceSelect').addEventListener('change', () => {
      const engine = $('cardTtsEngineSelect').value;
      const val = $('cardVoiceSelect').value;
      if (engine === 'system-local') {
        currentSettings.preferredVoiceName = val;
      } else if (engine === 'google-gemini' && val) {
        currentSettings.geminiTtsVoice = val;
      }
      if ($('modalVoiceSelect') && $('modalTtsEngineSelect').value === engine) {
        $('modalVoiceSelect').value = val;
      }
    });

    $('cardSpeechRateSelect').addEventListener('change', () => {
      currentSettings.speechRate = clampSpeechRate($('cardSpeechRateSelect').value);
      if ($('modalSpeechRateSelect')) $('modalSpeechRateSelect').value = String(currentSettings.speechRate);
    });

    // 儲存設定 Modal 變更（同步配色主題與自然語音設定）
    $('saveSettingsBtn').addEventListener('click', async () => {
      const geminiApiKey = $('apiKeyInput').value.trim();
      const openaiApiKey = $('openaiApiKeyInput').value.trim();
      const openaiBaseUrl = $('openaiBaseUrlInput').value.trim() || DEFAULT_OPENAI_BASE_URL;
      const geminiModel = $('modelSelect').value;
      const customModelId = $('customModelIdInput').value.trim();
      const customProvider = $('customProviderSelect').value;
      const themePreset = $('modalThemePresetSelect').value || 'midnight';
      const ttsEngine = $('modalTtsEngineSelect').value || 'edge-neural';
      const modalVoiceVal = $('modalVoiceSelect').value || '';
      const speechRate = clampSpeechRate($('modalSpeechRateSelect').value);

      if (geminiModel === '__custom__' && !customModelId) {
        showToast('⚠️ 請輸入自訂模型 ID！');
        $('customModelIdInput').focus();
        return;
      }

      let customShortcut = $('shortcutInput').value.trim();
      if (!customShortcut || customShortcut.startsWith('請直接按下')) {
        customShortcut = currentSettings.customShortcut || DEFAULT_SHORTCUT;
      }

      const nextEdgeVoiceMap = { ...DEFAULT_EDGE_VOICE_MAP, ...(currentSettings.edgeVoiceMap || {}) };
      if (ttsEngine === 'edge-neural' && modalVoiceVal) {
        if (modalVoiceVal.startsWith('zh-TW')) nextEdgeVoiceMap['zh-TW'] = modalVoiceVal;
        else if (modalVoiceVal.startsWith('en-US')) nextEdgeVoiceMap['en-US'] = modalVoiceVal;
      }

      const payload = {
        ...currentSettings,
        geminiApiKey,
        openaiApiKey,
        openaiBaseUrl,
        geminiModel,
        customModelId,
        customProvider,
        customShortcut,
        themePreset,
        ttsEngine,
        edgeVoiceMap: nextEdgeVoiceMap,
        geminiTtsVoice: ttsEngine === 'google-gemini' && modalVoiceVal
          ? modalVoiceVal
          : (currentSettings.geminiTtsVoice || 'Kore'),
        preferredVoiceName: ttsEngine === 'system-local'
          ? modalVoiceVal
          : (currentSettings.preferredVoiceName || ''),
        speechRate
      };

      if (!window.smartOcrApi || typeof window.smartOcrApi.saveSettings !== 'function') {
        showToast('⚠️ 無法連接設定儲存服務');
        return;
      }

      try {
        const res = await window.smartOcrApi.saveSettings(payload);
        if (res && res.settings) {
          applySettingsToOverlay(res.settings);
        } else {
          applySettingsToOverlay(payload);
        }

        if (res && res.shortcutRegistered === false) {
          const warnEl = $('modalShortcutWarn');
          warnEl.style.display = 'block';
          warnEl.textContent = `⚠️ 設定已儲存，但快速鍵「${customShortcut}」註冊失敗，可能與系統衝突${res.shortcutError ? `（${res.shortcutError}）` : ''}，請更換其他組合鍵。`;
          showToast('⚠️ 快速鍵可能與系統衝突，請調整組合鍵');
          return;
        }

        $('settingsModal').style.display = 'none';
        showToast(`✅ 設定與配色已儲存！快速鍵：${customShortcut}`);
        updateStatusBadge(
          `✨ 請按住滑鼠左鍵「拖曳框選」要辨識文字的區域（快速鍵：${customShortcut}｜按 Esc 或 ✕ 關閉）`,
          'normal'
        );

        // 若畫面中已有框選區域，儲存金鑰後立即重新辨識
        if (currentCroppedDataUrl) {
          performRegionOCR(currentCroppedDataUrl);
        }
      } catch (err) {
        showToast(`⚠️ 儲存設定失敗：${err.message}`);
      }
    });

    // 關閉框選辨識結果小卡片
    $('closeOcrCardBtn').addEventListener('click', () => {
      stopSpeaking();
      $('ocrResultCard').style.display = 'none';
      $('marqueeBox').style.display = 'none';
    });

    // 複製辨識文字按鈕
    $('copySelectedBtn').addEventListener('click', async () => {
      const text = getTargetTextFromCard();
      if (!text) {
        showToast('⚠️ 尚無可複製的文字');
        return;
      }
      await copyToClipboard(text);
      showToast('✅ 已複製文字到剪貼簿！');
    });

    // 語音朗讀按鈕（支援 Edge 自然神經 / Google Gemini 官方語音 / Google 地端語音備援）
    $('speakSelectedBtn').addEventListener('click', () => {
      if (speakState !== 'idle' || (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking)) {
        stopSpeaking();
        return;
      }
      const text = getTargetTextFromCard();
      if (!text) {
        showToast('⚠️ 尚無可發音的文字');
        return;
      }
      speakText(text);
    });

    // 查詢 Gemini 按鈕
    $('askGeminiBtn').addEventListener('click', () => {
      const text = getTargetTextFromCard();
      openGeminiPanelWithText(text, '請解釋並分析這段內容');
    });

    // 翻譯按鈕
    $('translateSelectedBtn').addEventListener('click', () => {
      const text = getTargetTextFromCard();
      openGeminiPanelWithText(
        text,
        '請將這段文字自然流暢地翻譯成繁體中文（若原文已是繁體中文，請翻譯成英文並附上重點說明）'
      );
    });

    // 另存框選區域為高畫質 JPG 圖片
    $('saveCropImageBtn').addEventListener('click', async () => {
      if (!currentScreenshotUrl || (!currentCroppedBounds && !currentCroppedDataUrl)) {
        showToast('⚠️ 尚無可儲存的框選圖片');
        return;
      }
      await saveCroppedRegionAsImage();
    });

    // 重新辨識此框選區域
    $('retryCropOcrBtn').addEventListener('click', () => {
      if (currentCroppedDataUrl) {
        performRegionOCR(currentCroppedDataUrl);
      }
    });

    // Gemini 懸浮對話視窗操作
    $('closeGeminiPanelBtn').addEventListener('click', () => {
      $('geminiPanel').style.display = 'none';
    });

    $('copyContextTextBtn').addEventListener('click', async () => {
      const val = $('contextTextarea').value.trim();
      if (val) {
        await copyToClipboard(val);
        showToast('✅ 已複製文字！');
      }
    });

    // 綁定 4 個快速提問 Chips
    document.querySelectorAll('.chip-btn').forEach((chip) => {
      chip.addEventListener('click', () => {
        const prompt = chip.getAttribute('data-prompt');
        if (prompt) {
          sendChatMessage(prompt);
        }
      });
    });

    // 送出多輪追問
    $('sendChatBtn').addEventListener('click', () => {
      const val = $('chatInput').value.trim();
      if (val) {
        $('chatInput').value = '';
        sendChatMessage(val);
      }
    });

    $('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('sendChatBtn').click();
      }
    });

    // 全域 Esc 快捷鍵關閉處理（若正在錄製快速鍵則略過；若設定 Modal 開啟則先關閉 Modal）
    window.addEventListener(
      'keydown',
      (e) => {
        if (document.activeElement && document.activeElement.id === 'shortcutInput') {
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          const modal = $('settingsModal');
          if (modal && modal.style.display === 'flex') {
            closeSettingsModalAndRestoreTheme();
            return;
          }
          closeCaptureOverlay();
        }
      },
      true
    );

    // 啟用拖曳框選與可拖曳 Gemini 對話面板
    setupMarqueeSelection();
    setupDraggablePanel($('geminiPanel'), $('geminiDragHandle'));
  }

  // ==================== 應用程式覆蓋層入口初始化 ====================

  document.addEventListener('DOMContentLoaded', async () => {
    bindOverlayEvents();
    applyOverlayTheme(currentSettings);

    // 預先觸發系統語音清單載入並監聽變動
    if (typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        populateVoiceSelects();
      });
    }

    // 監聽主程序傳入的凍結截圖初始化事件與設定同步事件（即時連動配色與語音）
    if (window.smartOcrApi) {
      if (typeof window.smartOcrApi.onOverlayInit === 'function') {
        window.smartOcrApi.onOverlayInit((payload) => {
          initOverlayState(payload);
        });
      }
      if (typeof window.smartOcrApi.onSettingsUpdated === 'function') {
        window.smartOcrApi.onSettingsUpdated((updatedSettings) => {
          applySettingsToOverlay(updatedSettings);
        });
      }
      if (typeof window.smartOcrApi.getSettings === 'function') {
        try {
          const initialSettings = await window.smartOcrApi.getSettings();
          applySettingsToOverlay(initialSettings);
        } catch {
          // 忽略初期讀取失敗，等待 onOverlayInit 注入
        }
      }
    }

    await populateVoiceSelects();
  });
})();
