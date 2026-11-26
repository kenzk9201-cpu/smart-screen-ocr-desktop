// settingsStore.js - 桌面應用程式本機設定持久化管理模組
// 負責讀取、驗證、正規化與儲存應用程式設定，並自動支援 Windows / macOS 行動免安裝模式 (portable-data/)

'use strict';

const fs = require('fs');
const path = require('path');

// 各語系預設 Edge 自然神經語音聲線（嚴格排除簡體中文語系）
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

// 預設自訂配色主題色盤（與深藍夜空 midnight 相同基準）
const DEFAULT_CUSTOM_THEME = Object.freeze({
  bgPrimary: '#0f172a',
  bgSurface: '#1e293b',
  accentColor: '#38bdf8',
  accentSecondary: '#7c3aed',
  textPrimary: '#f8fafc'
});

// 系統預設設定值（遵循全域 AI 模型、語音引擎與連動配色主題規範）
const DEFAULT_SETTINGS = Object.freeze({
  geminiApiKey: '',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  geminiModel: 'gemini-2.5-flash-lite',
  customModelId: '',
  customProvider: 'auto',
  customShortcut: 'Alt+Shift+S',
  launchAtLogin: false,
  speechRate: 1.0,
  preferredVoiceName: '',
  ttsEngine: 'edge-neural',
  edgeVoiceMap: DEFAULT_EDGE_VOICE_MAP,
  geminiTtsVoice: 'Kore',
  themePreset: 'midnight',
  customTheme: DEFAULT_CUSTOM_THEME
});

// 允許的自訂供應商類型清單
const VALID_CUSTOM_PROVIDERS = new Set(['auto', 'gemini', 'openai']);

// 允許的語音合成引擎模式
const VALID_TTS_ENGINES = new Set(['edge-neural', 'google-gemini', 'system-local']);

// 允許的 Google Gemini TTS 預建聲線
const VALID_GEMINI_TTS_VOICES = new Set(['Kore', 'Aoede', 'Puck', 'Charon', 'Fenrir', 'Leda']);

// 允許的全介面連動配色主題預設代號
const VALID_THEME_PRESETS = new Set([
  'midnight',
  'aurora-emerald',
  'violet-nebula',
  'amber-obsidian',
  'daylight-clean',
  'paper-warm',
  'custom'
]);

// 允許的 16 進位色碼格式
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * 檢查指定路徑是否為已存在的資料夾
 * @param {string} dirPath
 * @returns {boolean}
 */
function isExistingDirectory(dirPath) {
  try {
    return Boolean(dirPath) && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 自動偵測是否處於行動免安裝模式 (Portable Mode)，若啟用則回傳 portable-data 目錄路徑
 * 偵測優先順序：
 * 1. 環境變數 SMART_OCR_PORTABLE_DIR
 * 2. Windows electron-builder 可攜版環境變數 PORTABLE_EXECUTABLE_DIR（使用其下 portable-data/）
 * 3. 執行檔旁存在 portable-data/ 資料夾（相容 Windows 免安裝版與 macOS .app/Contents/MacOS/ 結構）
 * @param {{ env?: object, execPath?: string, platform?: string }} [options]
 * @returns {string|null} 若啟用行動模式則回傳資料目錄路徑，否則回傳 null
 */
function resolvePortableDataDir(options = {}) {
  const env = options.env || process.env;
  const execPath = options.execPath || process.execPath || '';
  const platform = options.platform || process.platform;

  // 1. 明確指定行動資料目錄環境變數
  if (env && typeof env.SMART_OCR_PORTABLE_DIR === 'string' && env.SMART_OCR_PORTABLE_DIR.trim()) {
    return path.resolve(env.SMART_OCR_PORTABLE_DIR.trim());
  }

  // 2. Windows electron-builder Portable 可攜版自動注入的可執行檔所在目錄
  if (env && typeof env.PORTABLE_EXECUTABLE_DIR === 'string' && env.PORTABLE_EXECUTABLE_DIR.trim()) {
    return path.join(path.resolve(env.PORTABLE_EXECUTABLE_DIR.trim()), 'portable-data');
  }

  if (typeof execPath === 'string' && execPath.trim()) {
    const normalizedExec = execPath.trim();
    const execDir = path.dirname(normalizedExec);

    // 3a. macOS .app 套件結構：<攜帶資料夾>/Smart Screen OCR.app/Contents/MacOS/<執行檔>
    // 往上三層即為 .app 所在的隨身資料夾，檢查其下是否存在 portable-data/
    const isMacAppBundle =
      /\.app[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/i.test(normalizedExec) ||
      (platform === 'darwin' &&
        path.basename(execDir) === 'MacOS' &&
        path.basename(path.dirname(execDir)) === 'Contents');

    if (isMacAppBundle) {
      const macBundleParentDir = path.resolve(execDir, '..', '..', '..');
      const macPortableCandidate = path.join(macBundleParentDir, 'portable-data');
      if (isExistingDirectory(macPortableCandidate)) {
        return macPortableCandidate;
      }
    }

    // 3b. Windows / Linux 執行檔同層資料夾下存在 portable-data/
    const siblingPortableCandidate = path.join(execDir, 'portable-data');
    if (isExistingDirectory(siblingPortableCandidate)) {
      return siblingPortableCandidate;
    }
  }

  return null;
}

/**
 * 解析預設設定檔完整路徑
 * 優先採用行動免安裝目錄 (portable-data/settings.json)；
 * 否則在 Electron 環境儲存於 userData/settings.json，非 Electron 環境則降級至系統暫存目錄。
 * @param {{ env?: object, execPath?: string, platform?: string }} [options]
 * @returns {string} 設定檔完整路徑
 */
function resolveDefaultSettingsPath(options = {}) {
  const portableDir = resolvePortableDataDir(options);
  if (portableDir) {
    return path.join(portableDir, 'settings.json');
  }

  try {
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      return path.join(electron.app.getPath('userData'), 'settings.json');
    }
  } catch {
    // 非 Electron 環境時改用下方的降級路徑
  }
  const os = require('os');
  return path.join(os.tmpdir(), 'smart-screen-ocr-desktop', 'settings.json');
}

/**
 * 複製並產生一份全新的預設設定物件（深拷貝巢狀物件）
 * @returns {object}
 */
function cloneDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    edgeVoiceMap: { ...DEFAULT_EDGE_VOICE_MAP },
    customTheme: { ...DEFAULT_CUSTOM_THEME }
  };
}

/**
 * 正規化 Edge 語系聲線對應表（僅保留合法語系鍵，排除非預期語系）
 * @param {object} rawMap
 * @returns {object}
 */
function sanitizeEdgeVoiceMap(rawMap) {
  const result = { ...DEFAULT_EDGE_VOICE_MAP };
  if (!rawMap || typeof rawMap !== 'object') {
    return result;
  }
  for (const langKey of Object.keys(DEFAULT_EDGE_VOICE_MAP)) {
    const val = rawMap[langKey];
    const prefix = `${langKey.toLowerCase()}-`;
    if (typeof val === 'string' && val.trim().toLowerCase().startsWith(prefix)) {
      result[langKey] = val.trim();
    }
  }
  return result;
}

/**
 * 正規化自訂主題色盤物件，確保所有色碼均為合法的 6 碼 Hex 顏色
 * @param {object} rawTheme
 * @returns {object}
 */
function sanitizeCustomTheme(rawTheme) {
  const result = { ...DEFAULT_CUSTOM_THEME };
  if (!rawTheme || typeof rawTheme !== 'object') {
    return result;
  }
  for (const key of Object.keys(DEFAULT_CUSTOM_THEME)) {
    const val = typeof rawTheme[key] === 'string' ? rawTheme[key].trim() : '';
    if (HEX_COLOR_REGEX.test(val)) {
      result[key] = val.toLowerCase();
    }
  }
  return result;
}

/**
 * 正規化並驗證設定物件，確保所有欄位型別正確且不會包含異常數值
 * @param {object} raw - 原始設定資料
 * @returns {object} 清理後的完整設定物件
 */
function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};

  const geminiApiKey = typeof input.geminiApiKey === 'string'
    ? input.geminiApiKey.trim()
    : DEFAULT_SETTINGS.geminiApiKey;

  const openaiApiKey = typeof input.openaiApiKey === 'string'
    ? input.openaiApiKey.trim()
    : DEFAULT_SETTINGS.openaiApiKey;

  const rawBaseUrl = typeof input.openaiBaseUrl === 'string'
    ? input.openaiBaseUrl.trim().replace(/\/+$/, '')
    : '';
  const openaiBaseUrl = rawBaseUrl || DEFAULT_SETTINGS.openaiBaseUrl;

  const rawModel = typeof input.geminiModel === 'string'
    ? input.geminiModel.trim()
    : '';
  const geminiModel = rawModel || DEFAULT_SETTINGS.geminiModel;

  const customModelId = typeof input.customModelId === 'string'
    ? input.customModelId.trim()
    : DEFAULT_SETTINGS.customModelId;

  const rawProvider = typeof input.customProvider === 'string'
    ? input.customProvider.trim()
    : DEFAULT_SETTINGS.customProvider;
  const customProvider = VALID_CUSTOM_PROVIDERS.has(rawProvider)
    ? rawProvider
    : DEFAULT_SETTINGS.customProvider;

  const rawShortcut = typeof input.customShortcut === 'string'
    ? input.customShortcut.trim()
    : '';
  const customShortcut = rawShortcut || DEFAULT_SETTINGS.customShortcut;

  const launchAtLogin = Boolean(input.launchAtLogin);

  // 語速數值限制在 0.5 ~ 2.0 之間，避免語音引擎拋錯
  const parsedRate = Number(input.speechRate);
  const speechRate = Number.isFinite(parsedRate)
    ? Math.min(2.0, Math.max(0.5, Math.round(parsedRate * 100) / 100))
    : DEFAULT_SETTINGS.speechRate;

  const preferredVoiceName = typeof input.preferredVoiceName === 'string'
    ? input.preferredVoiceName.trim()
    : DEFAULT_SETTINGS.preferredVoiceName;

  const rawTtsEngine = typeof input.ttsEngine === 'string'
    ? input.ttsEngine.trim()
    : DEFAULT_SETTINGS.ttsEngine;
  const ttsEngine = VALID_TTS_ENGINES.has(rawTtsEngine)
    ? rawTtsEngine
    : DEFAULT_SETTINGS.ttsEngine;

  const edgeVoiceMap = sanitizeEdgeVoiceMap(input.edgeVoiceMap);

  const rawGeminiVoice = typeof input.geminiTtsVoice === 'string'
    ? input.geminiTtsVoice.trim()
    : DEFAULT_SETTINGS.geminiTtsVoice;
  const geminiTtsVoice = VALID_GEMINI_TTS_VOICES.has(rawGeminiVoice)
    ? rawGeminiVoice
    : DEFAULT_SETTINGS.geminiTtsVoice;

  const rawThemePreset = typeof input.themePreset === 'string'
    ? input.themePreset.trim()
    : DEFAULT_SETTINGS.themePreset;
  const themePreset = VALID_THEME_PRESETS.has(rawThemePreset)
    ? rawThemePreset
    : DEFAULT_SETTINGS.themePreset;

  const customTheme = sanitizeCustomTheme(input.customTheme);

  return {
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
}

/**
 * 本機設定儲存器類別
 * 支援注入自訂檔案路徑與模擬環境參數，方便自動化單元測試隔離讀寫
 */
class SettingsStore {
  /**
   * @param {string} [customFilePath] - 可選的自訂設定檔完整路徑
   * @param {{ env?: object, execPath?: string, platform?: string }} [options] - 行動模式偵測環境參數
   */
  constructor(customFilePath, options = {}) {
    if (customFilePath) {
      this.filePath = customFilePath;
      this.portableMode = false;
    } else {
      const portableDir = resolvePortableDataDir(options);
      this.portableMode = Boolean(portableDir);
      this.filePath = portableDir
        ? path.join(portableDir, 'settings.json')
        : resolveDefaultSettingsPath(options);
    }
  }

  /**
   * 取得目前使用的設定檔路徑
   * @returns {string}
   */
  getFilePath() {
    return this.filePath;
  }

  /**
   * 回傳目前是否處於行動免安裝模式 (Portable Mode)
   * @returns {boolean}
   */
  isPortableMode() {
    return this.portableMode;
  }

  /**
   * 從磁碟讀取設定檔；若檔案不存在或 JSON 格式損毀，則安全回傳預設值
   * @returns {object} 完整設定物件
   */
  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return cloneDefaultSettings();
      }
      const content = fs.readFileSync(this.filePath, 'utf8');
      if (!content || !content.trim()) {
        return cloneDefaultSettings();
      }
      const parsed = JSON.parse(content);
      return sanitizeSettings(parsed);
    } catch (err) {
      // 設定檔毀損或權限異常時不中斷程式，改採預設設定
      console.warn('[SettingsStore] 讀取設定檔失敗，已自動回退至預設設定:', err.message);
      return cloneDefaultSettings();
    }
  }

  /**
   * 讀取設定（load 的別名，提供語意化呼叫）
   * @returns {object}
   */
  get() {
    return this.load();
  }

  /**
   * 讀取設定（與 IPC 命名一致的別名）
   * @returns {object}
   */
  getSettings() {
    return this.load();
  }

  /**
   * 合併並儲存設定至磁碟（支援巢狀 edgeVoiceMap 與 customTheme 局部更新）
   * @param {object} partialSettings - 要更新的設定欄位（可為部分欄位或完整物件）
   * @returns {object} 儲存後的完整設定物件
   */
  save(partialSettings) {
    const current = this.load();
    const incoming = partialSettings && typeof partialSettings === 'object' ? partialSettings : {};
    const merged = sanitizeSettings({
      ...current,
      ...incoming,
      edgeVoiceMap: {
        ...(current.edgeVoiceMap || DEFAULT_EDGE_VOICE_MAP),
        ...(incoming.edgeVoiceMap && typeof incoming.edgeVoiceMap === 'object' ? incoming.edgeVoiceMap : {})
      },
      customTheme: {
        ...(current.customTheme || DEFAULT_CUSTOM_THEME),
        ...(incoming.customTheme && typeof incoming.customTheme === 'object' ? incoming.customTheme : {})
      }
    });

    const dirPath = path.dirname(this.filePath);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  }

  /**
   * 儲存設定（save 的別名）
   * @param {object} partialSettings
   * @returns {object}
   */
  saveSettings(partialSettings) {
    return this.save(partialSettings);
  }

  /**
   * 重設設定為系統預設值並寫入磁碟
   * @returns {object}
   */
  reset() {
    const defaults = cloneDefaultSettings();
    const dirPath = path.dirname(this.filePath);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }
}

/**
 * 建立設定儲存器實例的工廠函式
 * @param {string} [customFilePath]
 * @param {{ env?: object, execPath?: string, platform?: string }} [options]
 * @returns {SettingsStore}
 */
function createSettingsStore(customFilePath, options = {}) {
  return new SettingsStore(customFilePath, options);
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_EDGE_VOICE_MAP,
  DEFAULT_CUSTOM_THEME,
  SettingsStore,
  createSettingsStore,
  sanitizeSettings,
  resolvePortableDataDir,
  resolveDefaultSettingsPath
};
