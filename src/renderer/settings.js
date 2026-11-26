// settings.js - Smart Screen OCR 跨平台桌面版主設定視窗邏輯（支援全域連動配色、Edge/Gemini 自然語音與行動免安裝偵測）

(() => {
  // 預設設定常數（與主程序 settingsStore.js 保持一致）
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

  // 目前載入的系統資訊、設定狀態與試聽音訊控制
  let currentPlatform = '';
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

  let statusClearTimer = null;
  let activeTestAudio = null;
  let testSpeakReqId = 0;
  let isTestAudioBusy = false;

  /**
   * 將鍵盤事件轉換為標準快速鍵字串（例如 "Alt+Shift+S"、"Meta+Shift+S"、"F8"）
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
   * 正規化語系代碼（底線轉連字號並轉小寫）
   */
  function normalizeLang(lang) {
    return (lang || '').replace('_', '-').toLowerCase();
  }

  /**
   * 過濾語音清單：僅保留符合系統規範語系（中文僅保留繁體中文語音）
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
   * 計算系統地端語音排序權重：嚴格將「Google + localService === true」排在第一順位
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
   * 依 Google 地端語音優先順序排序所有系統可用語音
   */
  function sortVoicesByPriority(voices) {
    return (voices || [])
      .filter(isAllowedVoice)
      .slice()
      .sort((a, b) => {
        const rankDiff = getVoiceRank(a) - getVoiceRank(b);
        if (rankDiff !== 0) return rankDiff;
        const langA = normalizeLang(a.lang);
        const langB = normalizeLang(b.lang);
        const preferredOrder = ['en-us', 'zh-tw', 'en-gb', 'ja-jp', 'ko-kr'];
        const idxA = preferredOrder.indexOf(langA);
        const idxB = preferredOrder.indexOf(langB);
        if (idxA !== idxB) {
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        }
        return (a.name || '').localeCompare(b.name || '');
      });
  }

  /**
   * 嚴格依規範優先序挑選最佳系統地端語音（Google + localService 排最優先）
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
      allowed[0] ||
      null
    );
  }

  /**
   * 取得系統內建 Web Speech API 語音清單（相容 voiceschanged 非同步載入）
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
      const finish = () => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener('voiceschanged', onChanged);
        resolve(window.speechSynthesis.getVoices() || []);
      };
      const onChanged = () => finish();
      window.speechSynthesis.addEventListener('voiceschanged', onChanged);
      setTimeout(finish, 450);
    });
  }

  /**
   * 為系統語音選項產生來源標籤（標註 Google 地端 / 自然語音 / 地端引擎）
   */
  function formatVoiceOptionLabel(voice) {
    const isGoogle = /google/i.test(voice.name || '');
    const isNatural = /natural/i.test(voice.name || '');
    const isLocal = voice.localService === true;

    let badge = '';
    if (isGoogle && isLocal) badge = '⭐ [Google 地端] ';
    else if (isGoogle) badge = '✨ [Google] ';
    else if (isNatural && isLocal) badge = '🌿 [自然地端] ';
    else if (isNatural) badge = '🌿 [自然語音] ';
    else if (isLocal) badge = '💻 [地端] ';

    return `${badge}${voice.name} (${voice.lang})`;
  }

  /**
   * 轉換平台代碼為易讀的作業系統名稱
   */
  function formatPlatformLabel(platform) {
    if (platform === 'darwin') return '🍎 macOS';
    if (platform === 'win32') return '🪟 Windows';
    return `💻 ${platform || '桌面系統'}`;
  }

  /**
   * 限制語速在 0.7x ~ 1.5x 合法範圍
   */
  function clampSpeechRate(rate) {
    const num = Number(rate);
    if (!Number.isFinite(num)) return DEFAULT_SPEECH_RATE;
    return Math.min(1.5, Math.max(0.7, Math.round(num * 10) / 10));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // 取得所有畫面 DOM 元件
    const appVersionBadge = document.getElementById('appVersionBadge');
    const platformBadge = document.getElementById('platformBadge');
    const shortcutStatusBadge = document.getElementById('shortcutStatusBadge');
    const portableModeBadge = document.getElementById('portableModeBadge');
    const triggerCaptureBtn = document.getElementById('triggerCaptureBtn');
    const testCaptureBtn = document.getElementById('testCaptureBtn');
    const macPermissionCard = document.getElementById('macPermissionCard');
    const openPermissionBtn = document.getElementById('openPermissionBtn');
    const refreshPermissionBtn = document.getElementById('refreshPermissionBtn');
    const shortcutInput = document.getElementById('shortcutInput');
    const resetShortcutBtn = document.getElementById('resetShortcutBtn');
    const shortcutHint = document.getElementById('shortcutHint');
    const shortcutConflictBanner = document.getElementById('shortcutConflictBanner');
    const launchAtLoginCheckbox = document.getElementById('launchAtLoginCheckbox');

    // 連動配色主題 DOM 元件
    const themePresetButtons = Array.from(document.querySelectorAll('.theme-preset-btn'));
    const customThemeBox = document.getElementById('customThemeBox');
    const customBgPrimary = document.getElementById('customBgPrimary');
    const customBgSurface = document.getElementById('customBgSurface');
    const customAccentColor = document.getElementById('customAccentColor');
    const customAccentSecondary = document.getElementById('customAccentSecondary');
    const customTextPrimary = document.getElementById('customTextPrimary');
    const resetCustomThemeBtn = document.getElementById('resetCustomThemeBtn');

    // AI 模型與金鑰 DOM 元件
    const modelSelect = document.getElementById('model');
    const customModelBox = document.getElementById('customModelBox');
    const customModelIdInput = document.getElementById('customModelId');
    const customProviderSelect = document.getElementById('customProvider');
    const apiKeyInput = document.getElementById('apiKey');
    const openaiApiKeyInput = document.getElementById('openaiApiKey');
    const openaiBaseUrlInput = document.getElementById('openaiBaseUrl');
    const aiStudioLink = document.getElementById('aiStudioLink');

    // 語音引擎與試聽 DOM 元件
    const ttsEngineSelect = document.getElementById('ttsEngineSelect');
    const edgeVoiceConfigBox = document.getElementById('edgeVoiceConfigBox');
    const edgeVoiceZhTwSelect = document.getElementById('edgeVoiceZhTwSelect');
    const edgeVoiceEnUsSelect = document.getElementById('edgeVoiceEnUsSelect');
    const geminiVoiceConfigBox = document.getElementById('geminiVoiceConfigBox');
    const geminiTtsVoiceSelect = document.getElementById('geminiTtsVoiceSelect');
    const systemVoiceConfigBox = document.getElementById('systemVoiceConfigBox');
    const preferredVoiceSelect = document.getElementById('preferredVoiceSelect');
    const speechRateRange = document.getElementById('speechRateRange');
    const speechRateValue = document.getElementById('speechRateValue');
    const testVoiceBtn = document.getElementById('testVoiceBtn');
    const voiceEngineHint = document.getElementById('voiceEngineHint');

    const saveBtn = document.getElementById('saveBtn');
    const statusMsg = document.getElementById('statusMsg');

    /**
     * 顯示狀態訊息（支援成功色與警告色）
     */
    function showStatus(text, isWarning = false) {
      statusMsg.style.color = isWarning ? '#fbbf24' : 'var(--badge-ok-text)';
      statusMsg.textContent = text;
      clearTimeout(statusClearTimer);
      statusClearTimer = setTimeout(() => {
        statusMsg.textContent = '';
      }, isWarning ? 6000 : 3400);
    }

    /**
     * 讀取目前自訂 5 色色盤數值
     */
    function readCustomThemeFromPickers() {
      return {
        bgPrimary: customBgPrimary.value || DEFAULT_CUSTOM_THEME.bgPrimary,
        bgSurface: customBgSurface.value || DEFAULT_CUSTOM_THEME.bgSurface,
        accentColor: customAccentColor.value || DEFAULT_CUSTOM_THEME.accentColor,
        accentSecondary: customAccentSecondary.value || DEFAULT_CUSTOM_THEME.accentSecondary,
        textPrimary: customTextPrimary.value || DEFAULT_CUSTOM_THEME.textPrimary
      };
    }

    /**
     * 即時將選中的配色主題套用到整個設定視窗與即時連動迷你預覽區
     */
    function applyThemePreview(presetId, customThemeObj) {
      const targetPreset = presetId || 'midnight';
      const customObj = { ...DEFAULT_CUSTOM_THEME, ...(customThemeObj || readCustomThemeFromPickers()) };

      currentSettings.themePreset = targetPreset;
      currentSettings.customTheme = customObj;

      // 更新主題按鈕選中樣式
      themePresetButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themePreset === targetPreset);
      });

      customThemeBox.style.display = targetPreset === 'custom' ? 'block' : 'none';

      // 套用連動 CSS 變數到 document.documentElement
      if (window.SmartOcrTheme && typeof window.SmartOcrTheme.applyThemeToDocument === 'function') {
        window.SmartOcrTheme.applyThemeToDocument({
          themePreset: targetPreset,
          customTheme: customObj
        });
      }
    }

    /**
     * 依所選語音發音引擎切換顯示對應聲線子面板與說明文字
     */
    function updateTtsEnginePanels() {
      const engine = ttsEngineSelect.value || 'edge-neural';
      edgeVoiceConfigBox.style.display = engine === 'edge-neural' ? 'block' : 'none';
      geminiVoiceConfigBox.style.display = engine === 'google-gemini' ? 'block' : 'none';
      systemVoiceConfigBox.style.display = engine === 'system-local' ? 'block' : 'none';

      if (engine === 'edge-neural') {
        voiceEngineHint.innerHTML =
          '🌟 已選用 <code>Edge 自然神經語音</code>（免金鑰），發音自然流暢；離線時將自動備援系統地端語音。';
      } else if (engine === 'google-gemini') {
        voiceEngineHint.innerHTML =
          '✨ 已選用 <code>Google Gemini 官方自然語音</code>（需填寫上方 Google Gemini API Key），缺金鑰或離線時自動備援系統地端語音。';
      } else {
        voiceEngineHint.innerHTML =
          '🖥️ 已選用 <code>系統內建地端語音</code>（完全離線可用），自動優先挑選 <code>Google 地端語音</code>。';
      }
    }

    /**
     * 切換「自訂模型 ID」輸入區塊顯示狀態
     */
    function toggleCustomBox() {
      customModelBox.style.display = modelSelect.value === '__custom__' ? 'block' : 'none';
    }

    /**
     * 更新頂部全域快速鍵狀態徽章與衝突提示列
     */
    function updateShortcutStatusUI(shortcutText, isRegistered = true, errorText = '') {
      if (isRegistered) {
        shortcutStatusBadge.className = 'info-pill ok';
        shortcutStatusBadge.textContent = `✅ 全域快速鍵：${shortcutText}`;
        shortcutConflictBanner.style.display = 'none';
        shortcutConflictBanner.textContent = '';
      } else {
        shortcutStatusBadge.className = 'info-pill warn';
        shortcutStatusBadge.textContent = `⚠️ 快速鍵衝突：${shortcutText}`;
        shortcutConflictBanner.style.display = 'block';
        shortcutConflictBanner.textContent = `⚠️ 全域快速鍵「${shortcutText}」註冊失敗，可能與系統或其他應用程式衝突${errorText ? `（${errorText}）` : ''}。請改用其他按鍵組合（例如 Alt+Shift+A 或 F8）後重新儲存。`;
      }
    }

    /**
     * 將設定物件套用至所有表單欄位並同步連動配色主題
     */
    function applySettingsToForm(settings) {
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

      apiKeyInput.value = currentSettings.geminiApiKey || '';
      openaiApiKeyInput.value = currentSettings.openaiApiKey || '';
      openaiBaseUrlInput.value = currentSettings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL;

      const savedModel = currentSettings.geminiModel || DEFAULT_MODEL;
      const hasOption = Array.from(modelSelect.options).some((opt) => opt.value === savedModel);
      if (hasOption) {
        modelSelect.value = savedModel;
        customModelIdInput.value = currentSettings.customModelId || '';
      } else {
        modelSelect.value = '__custom__';
        customModelIdInput.value = currentSettings.customModelId || savedModel;
      }
      customProviderSelect.value = currentSettings.customProvider || 'auto';
      toggleCustomBox();

      const shortcut = currentSettings.customShortcut || DEFAULT_SHORTCUT;
      shortcutInput.value = shortcut;
      shortcutInput.dataset.prev = shortcut;
      updateShortcutStatusUI(shortcut, true);

      launchAtLoginCheckbox.checked = Boolean(currentSettings.launchAtLogin);

      // 套用連動主題色盤與預設按鈕
      customBgPrimary.value = currentSettings.customTheme.bgPrimary;
      customBgSurface.value = currentSettings.customTheme.bgSurface;
      customAccentColor.value = currentSettings.customTheme.accentColor;
      customAccentSecondary.value = currentSettings.customTheme.accentSecondary;
      customTextPrimary.value = currentSettings.customTheme.textPrimary;
      applyThemePreview(currentSettings.themePreset || 'midnight', currentSettings.customTheme);

      // 套用語音發音引擎與聲線設定
      const engine = currentSettings.ttsEngine || 'edge-neural';
      if (Array.from(ttsEngineSelect.options).some((opt) => opt.value === engine)) {
        ttsEngineSelect.value = engine;
      }
      const zhVoice = currentSettings.edgeVoiceMap['zh-TW'] || DEFAULT_EDGE_VOICE_MAP['zh-TW'];
      const enVoice = currentSettings.edgeVoiceMap['en-US'] || DEFAULT_EDGE_VOICE_MAP['en-US'];
      if (Array.from(edgeVoiceZhTwSelect.options).some((opt) => opt.value === zhVoice)) {
        edgeVoiceZhTwSelect.value = zhVoice;
      }
      if (Array.from(edgeVoiceEnUsSelect.options).some((opt) => opt.value === enVoice)) {
        edgeVoiceEnUsSelect.value = enVoice;
      }
      const geminiVoice = currentSettings.geminiTtsVoice || 'Kore';
      if (Array.from(geminiTtsVoiceSelect.options).some((opt) => opt.value === geminiVoice)) {
        geminiTtsVoiceSelect.value = geminiVoice;
      }
      updateTtsEnginePanels();

      const safeRate = clampSpeechRate(currentSettings.speechRate);
      speechRateRange.value = String(safeRate);
      speechRateValue.textContent = `${safeRate.toFixed(1)}x`;

      if (preferredVoiceSelect.options.length > 0) {
        const targetVoice = currentSettings.preferredVoiceName || '';
        const hasVoice = Array.from(preferredVoiceSelect.options).some((opt) => opt.value === targetVoice);
        preferredVoiceSelect.value = hasVoice ? targetVoice : '';
      }
    }

    /**
     * 從主程序讀取支援的 Edge / Gemini 語音選項並更新下拉選單
     */
    async function loadTtsOptionsFromMain() {
      if (!window.smartOcrApi || typeof window.smartOcrApi.getTtsOptions !== 'function') return;
      try {
        const opts = await window.smartOcrApi.getTtsOptions();
        if (!opts) return;

        // 動態填入台灣中文 Edge 聲線
        const zhList = opts.edgeVoicesByLang && opts.edgeVoicesByLang['zh-TW'];
        if (Array.isArray(zhList) && zhList.length > 0) {
          const prev = edgeVoiceZhTwSelect.value;
          edgeVoiceZhTwSelect.innerHTML = '';
          zhList.forEach((v) => {
            const opt = document.createElement('option');
            opt.value = v.id || v.value || v.name || v;
            opt.textContent = v.label || v.name || opt.value;
            edgeVoiceZhTwSelect.appendChild(opt);
          });
          if (Array.from(edgeVoiceZhTwSelect.options).some((o) => o.value === prev)) {
            edgeVoiceZhTwSelect.value = prev;
          }
        }

        // 動態填入英文 Edge 聲線
        const enList = opts.edgeVoicesByLang && opts.edgeVoicesByLang['en-US'];
        if (Array.isArray(enList) && enList.length > 0) {
          const prev = edgeVoiceEnUsSelect.value;
          edgeVoiceEnUsSelect.innerHTML = '';
          enList.forEach((v) => {
            const opt = document.createElement('option');
            opt.value = v.id || v.value || v.name || v;
            opt.textContent = v.label || v.name || opt.value;
            edgeVoiceEnUsSelect.appendChild(opt);
          });
          if (Array.from(edgeVoiceEnUsSelect.options).some((o) => o.value === prev)) {
            edgeVoiceEnUsSelect.value = prev;
          }
        }

        // 動態填入 Gemini 官方自然語音声線
        if (Array.isArray(opts.geminiVoices) && opts.geminiVoices.length > 0) {
          const prev = geminiTtsVoiceSelect.value;
          geminiTtsVoiceSelect.innerHTML = '';
          opts.geminiVoices.forEach((v) => {
            const opt = document.createElement('option');
            opt.value = v.id || v.value || v.name || v;
            opt.textContent = v.label || v.name || opt.value;
            geminiTtsVoiceSelect.appendChild(opt);
          });
          if (Array.from(geminiTtsVoiceSelect.options).some((o) => o.value === prev)) {
            geminiTtsVoiceSelect.value = prev;
          }
        }
      } catch {
        // 保留 HTML 內建清單作為穩定備援
      }
    }

    /**
     * 載入並渲染系統地端語音下拉選單（Google 地端語音排最第一順位）
     */
    async function populateSystemVoiceDropdown() {
      const voices = await getVoicesAsync();
      const sorted = sortVoicesByPriority(voices);
      const savedVoiceName = currentSettings.preferredVoiceName || '';

      preferredVoiceSelect.innerHTML = '';
      const autoOpt = document.createElement('option');
      autoOpt.value = '';
      autoOpt.textContent = '⭐ 自動選擇最佳 Google 地端語音（依辨識文字語系）';
      preferredVoiceSelect.appendChild(autoOpt);

      sorted.forEach((voice) => {
        const opt = document.createElement('option');
        opt.value = voice.name;
        opt.textContent = formatVoiceOptionLabel(voice);
        preferredVoiceSelect.appendChild(opt);
      });

      const exists = Array.from(preferredVoiceSelect.options).some((opt) => opt.value === savedVoiceName);
      preferredVoiceSelect.value = exists ? savedVoiceName : '';
    }

    /**
     * 停止目前正在執行的語音試聽（涵蓋 Audio 播放與系統 SpeechSynthesis）
     */
    function stopTestVoice() {
      testSpeakReqId++;
      isTestAudioBusy = false;
      if (activeTestAudio) {
        try {
          activeTestAudio.pause();
          activeTestAudio.src = '';
        } catch {
          // 忽略音訊停止清理例外
        }
        activeTestAudio = null;
      }
      if (typeof window.speechSynthesis !== 'undefined') {
        window.speechSynthesis.cancel();
      }
      testVoiceBtn.textContent = '🔊 試聽目前語音';
    }

    /**
     * 使用系統內建 SpeechSynthesis 進行試聽（優先 Google 地端語音）
     */
    async function playSystemLocalTestVoice(sampleText, targetLang, rate) {
      if (typeof window.speechSynthesis === 'undefined') {
        showStatus('⚠️ 目前環境不支援系統語音朗讀功能', true);
        stopTestVoice();
        return;
      }
      const voices = await getVoicesAsync();
      const chosenVoice = pickPreferredGoogleVoice(voices, targetLang, preferredVoiceSelect.value);
      const utterance = new SpeechSynthesisUtterance(sampleText);
      utterance.lang = chosenVoice ? chosenVoice.lang : targetLang;
      if (chosenVoice) {
        utterance.voice = chosenVoice;
      }
      utterance.rate = rate;
      utterance.onstart = () => {
        isTestAudioBusy = true;
        testVoiceBtn.textContent = '⏹️ 停止試聽';
      };
      utterance.onend = () => stopTestVoice();
      utterance.onerror = () => stopTestVoice();

      window.speechSynthesis.cancel();
      isTestAudioBusy = true;
      testVoiceBtn.textContent = '⏹️ 停止試聽';
      window.speechSynthesis.speak(utterance);
    }

    /**
     * 重新查詢作業系統資訊、macOS 螢幕錄製權限、快捷鍵狀態與行動免安裝模式
     */
    async function refreshSystemInfo() {
      if (!window.smartOcrApi || typeof window.smartOcrApi.getSystemInfo !== 'function') return;
      try {
        const info = await window.smartOcrApi.getSystemInfo();
        currentPlatform = info?.platform || '';
        platformBadge.textContent = formatPlatformLabel(currentPlatform);
        if (info?.appVersion) {
          appVersionBadge.textContent = `v${info.appVersion}`;
        }

        if (currentPlatform === 'darwin') {
          shortcutHint.innerHTML =
            '支援 macOS 組合鍵（例如：<code>Alt+Shift+S</code>、<code>Meta+Shift+S</code>（⌘+⇧+S）或功能鍵 <code>F8</code>）。儲存後全域皆可截圖！';
        }

        // macOS 若尚未授予「螢幕錄製」權限，顯示醒目授權引導卡片
        if (currentPlatform === 'darwin' && info?.screenPermission !== 'granted') {
          macPermissionCard.style.display = 'block';
        } else {
          macPermissionCard.style.display = 'none';
        }

        // 顯示行動免安裝模式徽章（當設定儲存於 portable-data/ 隨身資料夾時）
        if (info?.isPortable) {
          portableModeBadge.style.display = 'inline-flex';
          if (info.settingsFilePath) {
            portableModeBadge.title = `隨身設定檔路徑：${info.settingsFilePath}`;
          }
        } else {
          portableModeBadge.style.display = 'none';
        }

        // 同步顯示啟動時全域快速鍵註冊狀態與衝突提醒
        if (typeof info?.shortcutRegistered === 'boolean') {
          updateShortcutStatusUI(
            currentSettings.customShortcut || DEFAULT_SHORTCUT,
            info.shortcutRegistered,
            info.shortcutError || ''
          );
        }

        if (typeof info?.loginItemEnabled === 'boolean' && currentSettings.launchAtLogin === undefined) {
          launchAtLoginCheckbox.checked = info.loginItemEnabled;
        }
      } catch {
        platformBadge.textContent = '💻 桌面系統';
      }
    }

    /**
     * 觸發主程序全螢幕截圖覆蓋層
     */
    async function handleTriggerCapture() {
      if (!window.smartOcrApi || typeof window.smartOcrApi.triggerCapture !== 'function') {
        showStatus('⚠️ 無法連接桌面截圖服務', true);
        return;
      }
      try {
        await window.smartOcrApi.triggerCapture();
      } catch (err) {
        showStatus(`⚠️ 啟動截圖失敗：${err.message}`, true);
      }
    }

    // ==================== 綁定互動事件 ====================

    // 綁定連動配色預設色卡按鈕
    themePresetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.themePreset || 'midnight';
        applyThemePreview(preset, readCustomThemeFromPickers());
      });
    });

    // 綁定自訂 5 色色盤即時預覽
    [customBgPrimary, customBgSurface, customAccentColor, customAccentSecondary, customTextPrimary].forEach((picker) => {
      picker.addEventListener('input', () => {
        applyThemePreview('custom', readCustomThemeFromPickers());
      });
    });

    // 還原預設 5 色自訂色盤
    resetCustomThemeBtn.addEventListener('click', () => {
      customBgPrimary.value = DEFAULT_CUSTOM_THEME.bgPrimary;
      customBgSurface.value = DEFAULT_CUSTOM_THEME.bgSurface;
      customAccentColor.value = DEFAULT_CUSTOM_THEME.accentColor;
      customAccentSecondary.value = DEFAULT_CUSTOM_THEME.accentSecondary;
      customTextPrimary.value = DEFAULT_CUSTOM_THEME.textPrimary;
      applyThemePreview('custom', DEFAULT_CUSTOM_THEME);
    });

    // 綁定模型切換、語音引擎切換與語速滑桿
    modelSelect.addEventListener('change', toggleCustomBox);
    ttsEngineSelect.addEventListener('change', () => {
      stopTestVoice();
      updateTtsEnginePanels();
    });

    speechRateRange.addEventListener('input', () => {
      const rate = clampSpeechRate(speechRateRange.value);
      speechRateValue.textContent = `${rate.toFixed(1)}x`;
    });

    // 綁定立即截圖與測試截圖按鈕
    triggerCaptureBtn.addEventListener('click', handleTriggerCapture);
    testCaptureBtn.addEventListener('click', handleTriggerCapture);

    // 綁定 macOS 螢幕錄製權限按鈕
    openPermissionBtn.addEventListener('click', async () => {
      if (window.smartOcrApi && typeof window.smartOcrApi.openScreenPermissionSettings === 'function') {
        await window.smartOcrApi.openScreenPermissionSettings();
      }
    });

    refreshPermissionBtn.addEventListener('click', async () => {
      await refreshSystemInfo();
      if (macPermissionCard.style.display === 'none') {
        showStatus('✅ 已取得 macOS 螢幕錄製權限！');
      } else {
        showStatus('⚠️ 尚未偵測到螢幕錄製權限，授權後請重新啟動應用程式。', true);
      }
    });

    // 外部連結改由系統原生瀏覽器開啟
    aiStudioLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.smartOcrApi && typeof window.smartOcrApi.openExternalUrl === 'function') {
        window.smartOcrApi.openExternalUrl(GEMINI_API_KEY_URL);
      }
    });

    // 語音試聽按鈕（支援 Edge 自然神經 / Google Gemini 自然語音 + 系統地端語音備援）
    testVoiceBtn.addEventListener('click', async () => {
      if (isTestAudioBusy || (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking)) {
        stopTestVoice();
        return;
      }

      const reqId = ++testSpeakReqId;
      const engine = ttsEngineSelect.value || 'edge-neural';
      const rate = clampSpeechRate(speechRateRange.value);
      const sampleZh = '您好，Smart Screen OCR 自然語音朗讀測試正常。';

      if (engine === 'system-local') {
        await playSystemLocalTestVoice(sampleZh, 'zh-TW', rate);
        return;
      }

      if (!window.smartOcrApi || typeof window.smartOcrApi.synthesizeSpeech !== 'function') {
        showStatus('⚠️ 無法連接自然語音服務，已自動切換系統地端語音試聽', true);
        await playSystemLocalTestVoice(sampleZh, 'zh-TW', rate);
        return;
      }

      const voiceName = engine === 'edge-neural'
        ? edgeVoiceZhTwSelect.value
        : geminiTtsVoiceSelect.value;

      isTestAudioBusy = true;
      testVoiceBtn.textContent = '⏳ 合成語音中...';

      try {
        const res = await window.smartOcrApi.synthesizeSpeech({
          text: sampleZh,
          lang: 'zh-TW',
          rate,
          engine,
          voiceName
        });

        if (reqId !== testSpeakReqId) return;

        if (res && res.ok && res.audioDataUrl) {
          const audio = new Audio(res.audioDataUrl);
          audio.playbackRate = rate;
          activeTestAudio = audio;
          audio.onended = () => stopTestVoice();
          audio.onerror = () => {
            showStatus('⚠️ 音訊播放失敗，已自動切換系統地端語音', true);
            stopTestVoice();
          };
          testVoiceBtn.textContent = '⏹️ 停止試聽';
          await audio.play();
          return;
        }

        const errDetail = res?.error || '語音服務暫時無法回應';
        showStatus(`⚠️ ${errDetail}，已自動備援系統地端語音試聽`, true);
        await playSystemLocalTestVoice(sampleZh, 'zh-TW', rate);
      } catch (err) {
        if (reqId !== testSpeakReqId) return;
        showStatus(`⚠️ 語音合成異常（${err.message}），已切換系統地端語音`, true);
        await playSystemLocalTestVoice(sampleZh, 'zh-TW', rate);
      }
    });

    // 快捷鍵錄製互動
    shortcutInput.addEventListener('focus', () => {
      shortcutInput.dataset.prev = shortcutInput.value;
      shortcutInput.value = '請直接按下鍵盤組合鍵 (例如 Alt+Shift+S)...';
    });

    shortcutInput.addEventListener('blur', () => {
      if (shortcutInput.value.startsWith('請直接按下')) {
        shortcutInput.value = shortcutInput.dataset.prev || DEFAULT_SHORTCUT;
      }
    });

    shortcutInput.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        shortcutInput.value = shortcutInput.dataset.prev || DEFAULT_SHORTCUT;
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

    resetShortcutBtn.addEventListener('click', () => {
      shortcutInput.value = DEFAULT_SHORTCUT;
      shortcutInput.dataset.prev = DEFAULT_SHORTCUT;
    });

    // 儲存設定按鈕：同步儲存所有欄位、主題配色與語音設定至主程序並廣播至所有視窗
    saveBtn.addEventListener('click', async () => {
      const geminiApiKey = apiKeyInput.value.trim();
      const openaiApiKey = openaiApiKeyInput.value.trim();
      const openaiBaseUrl = openaiBaseUrlInput.value.trim() || DEFAULT_OPENAI_BASE_URL;
      const geminiModel = modelSelect.value;
      const customModelId = customModelIdInput.value.trim();
      const customProvider = customProviderSelect.value;
      const launchAtLogin = Boolean(launchAtLoginCheckbox.checked);
      const speechRate = clampSpeechRate(speechRateRange.value);
      const preferredVoiceName = preferredVoiceSelect.value || '';
      const ttsEngine = ttsEngineSelect.value || 'edge-neural';
      const geminiTtsVoice = geminiTtsVoiceSelect.value || 'Kore';
      const edgeVoiceMap = {
        ...DEFAULT_EDGE_VOICE_MAP,
        ...(currentSettings.edgeVoiceMap || {}),
        'zh-TW': edgeVoiceZhTwSelect.value || DEFAULT_EDGE_VOICE_MAP['zh-TW'],
        'en-US': edgeVoiceEnUsSelect.value || DEFAULT_EDGE_VOICE_MAP['en-US']
      };
      const themePreset = currentSettings.themePreset || 'midnight';
      const customTheme = readCustomThemeFromPickers();

      if (geminiModel === '__custom__' && !customModelId) {
        showStatus('⚠️ 請輸入自訂模型 ID！', true);
        customModelIdInput.focus();
        return;
      }

      let customShortcut = shortcutInput.value.trim();
      if (!customShortcut || customShortcut.startsWith('請直接按下')) {
        customShortcut = currentSettings.customShortcut || DEFAULT_SHORTCUT;
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
        launchAtLogin,
        speechRate,
        preferredVoiceName,
        ttsEngine,
        edgeVoiceMap,
        geminiTtsVoice,
        themePreset,
        customTheme
      };

      if (!window.smartOcrApi || typeof window.smartOcrApi.saveSettings !== 'function') {
        showStatus('⚠️ 無法連接設定儲存服務', true);
        return;
      }

      try {
        const res = await window.smartOcrApi.saveSettings(payload);
        if (res && res.settings) {
          applySettingsToForm(res.settings);
        }

        if (res && res.shortcutRegistered === false) {
          updateShortcutStatusUI(customShortcut, false, res.shortcutError || '');
          showStatus('⚠️ 設定已儲存，但全域快速鍵可能與系統衝突，請更換組合鍵！', true);
          return;
        }

        updateShortcutStatusUI(customShortcut, true);
        showStatus(`✅ 設定與連動配色已儲存！（全域快速鍵：${customShortcut}）`, false);
      } catch (err) {
        showStatus(`⚠️ 儲存設定失敗：${err.message}`, true);
      }
    });

    // 監聽來自其他視窗或系統匣的設定同步通知（即時連動主題與語音）
    if (window.smartOcrApi && typeof window.smartOcrApi.onSettingsUpdated === 'function') {
      window.smartOcrApi.onSettingsUpdated((updatedSettings) => {
        applySettingsToForm(updatedSettings);
      });
    }

    // 監聽系統語音清單變動事件以即時更新地端語音下拉選單
    if (typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        populateSystemVoiceDropdown();
      });
    }

    // 視窗關閉前停止試聽音訊
    window.addEventListener('beforeunload', stopTestVoice);

    // 初始化載入主程序語音清單、已存設定、系統資訊與地端語音
    await loadTtsOptionsFromMain();

    if (window.smartOcrApi && typeof window.smartOcrApi.getSettings === 'function') {
      try {
        const saved = await window.smartOcrApi.getSettings();
        applySettingsToForm(saved);
      } catch (err) {
        showStatus(`⚠️ 讀取設定失敗：${err.message}`, true);
      }
    } else {
      applyThemePreview('midnight', DEFAULT_CUSTOM_THEME);
    }

    await Promise.all([refreshSystemInfo(), populateSystemVoiceDropdown()]);
  });
})();
