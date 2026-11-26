// shortcutHelper.js - 跨平台快捷鍵格式轉換與驗證輔助模組
// 負責將前端錄製的快捷鍵字串轉換為 Electron globalShortcut 支援的 Accelerator 格式

'use strict';

// 預設截圖快捷鍵
const DEFAULT_SHORTCUT = 'Alt+Shift+S';

// 主要功能修飾鍵集合（不含單獨 Shift，避免劫持正常大寫輸入）
const PRIMARY_MODIFIERS = new Set([
  'CommandOrControl',
  'Control',
  'Alt',
  'AltGr',
  'Command',
  'Super'
]);

// 修飾鍵正規化排列順序，確保相同組合鍵輸出符合作業系統慣例（例如 Command+Shift+S、Control+Shift+S、Alt+Shift+S）
const MODIFIER_ORDER = [
  'CommandOrControl',
  'Control',
  'Command',
  'Super',
  'Alt',
  'AltGr',
  'Shift'
];

// 特殊按鍵名稱對應表（將瀏覽器 KeyboardEvent.key 轉為 Electron Accelerator 鍵名）
const SPECIAL_KEY_MAP = Object.freeze({
  ' ': 'Space',
  space: 'Space',
  spacebar: 'Space',
  arrowup: 'Up',
  up: 'Up',
  arrowdown: 'Down',
  down: 'Down',
  arrowleft: 'Left',
  left: 'Left',
  arrowright: 'Right',
  right: 'Right',
  enter: 'Return',
  return: 'Return',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  printscreen: 'PrintScreen',
  prtsc: 'PrintScreen',
  plus: 'Plus',
  '+': 'Plus',
  capslock: 'Capslock',
  numlock: 'Numlock',
  scrolllock: 'Scrolllock'
});

// Electron Accelerator 允許的標點符號鍵集合
const ALLOWED_PUNCTUATION_KEYS = new Set([
  '-', '=', '[', ']', '\\', ';', '\'', ',', '.', '/', '`',
  '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '{', '}', '|', ':', '"', '<', '>', '?'
]);

/**
 * 將單一修飾鍵標記正規化為 Electron Accelerator 格式
 * @param {string} rawToken - 原始修飾鍵文字
 * @param {string} platform - 作業系統平台 ('win32' | 'darwin' | 'linux')
 * @returns {string|null} 正規化後的修飾鍵名稱，若非修飾鍵則回傳 null
 */
function normalizeModifierToken(rawToken, platform) {
  const lower = rawToken.trim().toLowerCase();
  switch (lower) {
    case 'ctrl':
    case 'control':
      return 'Control';
    case 'alt':
    case 'option':
    case 'opt':
      return 'Alt';
    case 'altgr':
      return 'AltGr';
    case 'shift':
      return 'Shift';
    case 'cmdorctrl':
    case 'commandorcontrol':
      return 'CommandOrControl';
    case 'meta':
    case 'cmd':
    case 'command':
    case 'super':
    case 'win':
    case 'windows':
      // 在 macOS 使用 Command，在 Windows / Linux 使用 Super
      return platform === 'darwin' ? 'Command' : 'Super';
    default:
      return null;
  }
}

/**
 * 將單一主按鍵標記正規化為 Electron Accelerator 格式
 * @param {string} rawToken - 原始主按鍵文字
 * @returns {string|null} 正規化後的按鍵名稱，若不合法則回傳 null
 */
function normalizeMainKeyToken(rawToken) {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;

  // 單一英文字母（A-Z）
  if (/^[a-zA-Z]$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // 單一數字（0-9）
  if (/^[0-9]$/.test(trimmed)) {
    return trimmed;
  }

  // 功能鍵（F1 ~ F24）
  const fnMatch = /^f(\d{1,2})$/i.exec(trimmed);
  if (fnMatch) {
    const num = Number(fnMatch[1]);
    if (num >= 1 && num <= 24) {
      return `F${num}`;
    }
    return null;
  }

  // 特殊控制鍵（如 Space、Up、Return、PrintScreen）
  const lower = trimmed.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SPECIAL_KEY_MAP, lower)) {
    return SPECIAL_KEY_MAP[lower];
  }

  // 標點符號鍵
  if (trimmed.length === 1 && ALLOWED_PUNCTUATION_KEYS.has(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * 檢查是否為可單獨使用的功能鍵（F1~F24 或 PrintScreen）
 * @param {string} keyName - 正規化後的主按鍵名稱
 * @returns {boolean}
 */
function isStandaloneAllowedKey(keyName) {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(keyName) || keyName === 'PrintScreen';
}

/**
 * 解析快捷鍵字串為標記陣列，並正確處理末尾為 '+' 符號的情況（例如 'Ctrl++'）
 * @param {string} shortcutString - 原始快捷鍵字串
 * @returns {string[]|null} 標記陣列；若包含空段落則回傳 null
 */
function splitShortcutTokens(shortcutString) {
  const trimmed = shortcutString.trim();
  if (!trimmed) return null;

  // 特殊處理「Ctrl++」這類以加號作為主按鍵的寫法
  let normalizedInput = trimmed;
  let endsWithPlusKey = false;
  if (normalizedInput.endsWith('++')) {
    normalizedInput = normalizedInput.slice(0, -1);
    endsWithPlusKey = true;
  }

  const rawParts = normalizedInput.split('+').map((part) => part.trim());
  if (endsWithPlusKey) {
    // 若原本為 'Ctrl++'，split 後最後一個元素會是空字串，將其替換為 '+'
    if (rawParts[rawParts.length - 1] === '') {
      rawParts[rawParts.length - 1] = '+';
    }
  }

  // 若任何段落為空（例如 'Ctrl++S' 或 'Alt+'），視為無效格式
  if (rawParts.some((part) => part.length === 0)) {
    return null;
  }

  return rawParts;
}

/**
 * 將前端錄製的快捷鍵字串轉換並驗證為 Electron globalShortcut 支援的 Accelerator
 * @param {string} shortcutString - 原始快捷鍵字串（例如 'Alt+Shift+S'、'Ctrl+Space'、'Meta+Shift+S'、'F8'）
 * @param {string} [platform=process.platform] - 目標作業系統平台
 * @returns {{ valid: boolean, accelerator: string, displayLabel: string, error?: string }}
 */
function toElectronAccelerator(shortcutString, platform = process.platform) {
  if (typeof shortcutString !== 'string' || !shortcutString.trim()) {
    return {
      valid: false,
      accelerator: '',
      displayLabel: '',
      error: '快捷鍵不可為空白'
    };
  }

  const tokens = splitShortcutTokens(shortcutString);
  if (!tokens || tokens.length === 0) {
    return {
      valid: false,
      accelerator: '',
      displayLabel: '',
      error: `快捷鍵格式無效：${shortcutString}`
    };
  }

  const modifiers = new Set();
  let mainKey = null;

  for (const token of tokens) {
    const mod = normalizeModifierToken(token, platform);
    if (mod) {
      modifiers.add(mod);
      continue;
    }

    const key = normalizeMainKeyToken(token);
    if (!key) {
      return {
        valid: false,
        accelerator: '',
        displayLabel: '',
        error: `不支援的按鍵名稱：${token}`
      };
    }

    if (mainKey) {
      return {
        valid: false,
        accelerator: '',
        displayLabel: '',
        error: `快捷鍵只能包含一個主按鍵（偵測到 ${mainKey} 與 ${key}）`
      };
    }
    mainKey = key;
  }

  if (!mainKey) {
    return {
      valid: false,
      accelerator: '',
      displayLabel: '',
      error: '快捷鍵必須包含至少一個主按鍵（不可只有修飾鍵）'
    };
  }

  // 非功能鍵（非 F1~F24 / PrintScreen）必須搭配至少一個主要修飾鍵（Ctrl/Alt/Command/Super）
  const hasPrimaryModifier = Array.from(modifiers).some((m) => PRIMARY_MODIFIERS.has(m));
  if (!isStandaloneAllowedKey(mainKey) && !hasPrimaryModifier) {
    return {
      valid: false,
      accelerator: '',
      displayLabel: '',
      error: '一般按鍵必須搭配 Ctrl、Alt 或 Command/Meta 修飾鍵使用'
    };
  }

  // 依標準順序組合 Electron Accelerator 字串
  const orderedModifiers = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  const accelerator = [...orderedModifiers, mainKey].join('+');
  const displayLabel = formatShortcutForDisplay(accelerator, platform);

  return {
    valid: true,
    accelerator,
    displayLabel
  };
}

/**
 * 將 Electron Accelerator 轉換為適合顯示於系統匣選單與介面的易讀標籤
 * @param {string} shortcutString - 快捷鍵或 Accelerator 字串
 * @param {string} [platform=process.platform] - 作業系統平台
 * @returns {string} 易讀標籤
 */
function formatShortcutForDisplay(shortcutString, platform = process.platform) {
  if (typeof shortcutString !== 'string' || !shortcutString.trim()) {
    return DEFAULT_SHORTCUT;
  }
  return shortcutString
    .split('+')
    .map((part) => {
      const p = part.trim();
      if (p === 'Control') return 'Ctrl';
      if (p === 'CommandOrControl') return platform === 'darwin' ? 'Cmd' : 'Ctrl';
      if (p === 'Command') return 'Cmd';
      if (p === 'Super') return platform === 'darwin' ? 'Cmd' : 'Win';
      if (p === 'Alt' && platform === 'darwin') return 'Option';
      return p;
    })
    .join('+');
}

/**
 * 快速驗證快捷鍵字串是否有效
 * @param {string} shortcutString - 原始快捷鍵字串
 * @param {string} [platform=process.platform] - 作業系統平台
 * @returns {boolean}
 */
function isValidShortcut(shortcutString, platform = process.platform) {
  return toElectronAccelerator(shortcutString, platform).valid;
}

module.exports = {
  DEFAULT_SHORTCUT,
  toElectronAccelerator,
  formatShortcutForDisplay,
  isValidShortcut
};
