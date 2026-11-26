// themeHelper.js - Smart Screen OCR 全介面連動配色核心模組
// 同時支援瀏覽器（掛載於 window.SmartOcrTheme）與 Node.js（module.exports）環境

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.SmartOcrTheme = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // 預設自訂色盤（與深藍夜空 midnight 完全一致）
  const DEFAULT_CUSTOM_THEME = Object.freeze({
    bgPrimary: '#0f172a',
    bgSurface: '#1e293b',
    accentColor: '#38bdf8',
    accentSecondary: '#7c3aed',
    textPrimary: '#f8fafc'
  });

  // 內建 6 組高質感一鍵連動配色主題
  const THEME_PRESETS = Object.freeze({
    midnight: Object.freeze({
      id: 'midnight',
      name: '🌌 深藍夜空',
      description: '經典深邃夜空與天空藍光暈（預設）',
      bgPrimary: '#0f172a',
      bgSurface: '#1e293b',
      accentColor: '#38bdf8',
      accentSecondary: '#7c3aed',
      textPrimary: '#f8fafc'
    }),
    'aurora-emerald': Object.freeze({
      id: 'aurora-emerald',
      name: '🌿 翡翠森霧',
      description: '深墨綠基底搭配清透翡翠與天藍光澤',
      bgPrimary: '#071a17',
      bgSurface: '#0f2e28',
      accentColor: '#34d399',
      accentSecondary: '#0ea5e9',
      textPrimary: '#ecfdf5'
    }),
    'violet-nebula': Object.freeze({
      id: 'violet-nebula',
      name: '🔮 紫羅蘭星雲',
      description: '星雲深紫搭配霓虹丁香與莓果漸層',
      bgPrimary: '#130f26',
      bgSurface: '#221b40',
      accentColor: '#c084fc',
      accentSecondary: '#ec4899',
      textPrimary: '#faf5ff'
    }),
    'amber-obsidian': Object.freeze({
      id: 'amber-obsidian',
      name: '🔥 琥珀曜石',
      description: '沉穩暖炭黑搭配琥珀金與熾熱暖紅',
      bgPrimary: '#18130e',
      bgSurface: '#292118',
      accentColor: '#f59e0b',
      accentSecondary: '#ef4444',
      textPrimary: '#fffbeb'
    }),
    'daylight-clean': Object.freeze({
      id: 'daylight-clean',
      name: '☀️ 晨光純白',
      description: '高對比極簡淺色，日間閱讀清晰無負擔',
      bgPrimary: '#f1f5f9',
      bgSurface: '#ffffff',
      accentColor: '#2563eb',
      accentSecondary: '#7c3aed',
      textPrimary: '#0f172a'
    }),
    'paper-warm': Object.freeze({
      id: 'paper-warm',
      name: '📖 溫潤羊皮紙',
      description: '護眼淺暖紙質底色搭配焦糖琥珀與青綠',
      bgPrimary: '#f5efe6',
      bgSurface: '#fffcf7',
      accentColor: '#b45309',
      accentSecondary: '#0f766e',
      textPrimary: '#292524'
    })
  });

  /**
   * 驗證並正規化 6 碼 HEX 色碼，若格式無效則回退至 fallback
   */
  function normalizeHex(hex, fallback) {
    if (typeof hex !== 'string') return fallback;
    const trimmed = hex.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return fallback;
  }

  /**
   * 將 HEX 色碼解析為 RGB 數值物件 { r, g, b }
   */
  function hexToRgb(hex) {
    const safe = normalizeHex(hex, '#0f172a').slice(1);
    return {
      r: parseInt(safe.slice(0, 2), 16),
      g: parseInt(safe.slice(2, 4), 16),
      b: parseInt(safe.slice(4, 6), 16)
    };
  }

  /**
   * 將 HEX 色碼轉換為指定透明度的 rgba() 字串
   */
  function hexToRgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    const a = Math.min(1, Math.max(0, Number(alpha)));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /**
   * 依據 sRGB 相對亮度公式判斷顏色屬於淺色或深色（回傳 true 代表淺色）
   */
  function isLightColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    // 採用 W3C 感知亮度加權公式，確保淺深背景對比度判斷精準
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance >= 0.58;
  }

  /**
   * 依據使用者設定解析出完整主題色彩 Token 與所有連動 CSS 變數
   * @param {object} settings - 包含 themePreset 與 customTheme 的設定物件
   * @returns {object} 包含 presetId、isLight、palette 與 cssVars 的完整主題物件
   */
  function resolveThemeTokens(settings) {
    const rawPreset = (settings && settings.themePreset) || 'midnight';
    const isCustom = rawPreset === 'custom';
    const basePreset = THEME_PRESETS[rawPreset] || THEME_PRESETS.midnight;
    const presetId = isCustom ? 'custom' : basePreset.id;

    // 組合核心 5 色色盤
    const srcCustom = (settings && settings.customTheme) || {};
    const palette = isCustom
      ? {
          bgPrimary: normalizeHex(srcCustom.bgPrimary, DEFAULT_CUSTOM_THEME.bgPrimary),
          bgSurface: normalizeHex(srcCustom.bgSurface, DEFAULT_CUSTOM_THEME.bgSurface),
          accentColor: normalizeHex(srcCustom.accentColor, DEFAULT_CUSTOM_THEME.accentColor),
          accentSecondary: normalizeHex(srcCustom.accentSecondary, DEFAULT_CUSTOM_THEME.accentSecondary),
          textPrimary: normalizeHex(srcCustom.textPrimary, DEFAULT_CUSTOM_THEME.textPrimary)
        }
      : {
          bgPrimary: basePreset.bgPrimary,
          bgSurface: basePreset.bgSurface,
          accentColor: basePreset.accentColor,
          accentSecondary: basePreset.accentSecondary,
          textPrimary: basePreset.textPrimary
        };

    const isLight = isLightColor(palette.bgSurface);

    // 計算主按鈕漸層起始色（midnight 忠實保留經典 #2563eb -> #7c3aed）
    const primaryGradStart = presetId === 'midnight' ? '#2563eb' : palette.accentColor;
    const primaryBtnText = isLightColor(primaryGradStart) && isLightColor(palette.accentSecondary)
      ? '#0f172a'
      : '#ffffff';

    // 使用者訊息泡泡底色與文字對比色
    const userBubbleBg = presetId === 'midnight' ? '#2563eb' : palette.accentColor;
    const userBubbleText = isLightColor(userBubbleBg) ? '#0f172a' : '#ffffff';

    // 依底色明暗自動衍生次要文字、面板、輸入框、邊框、按鈕與 AI 氣泡色彩
    const cssVars = {
      '--bg-primary': palette.bgPrimary,
      '--bg-surface': palette.bgSurface,
      '--accent-color': palette.accentColor,
      '--accent-secondary': palette.accentSecondary,
      '--text-primary': palette.textPrimary,
      '--text-secondary': isLight
        ? hexToRgba(palette.textPrimary, 0.78)
        : hexToRgba(palette.textPrimary, 0.8),
      '--text-muted': isLight
        ? hexToRgba(palette.textPrimary, 0.56)
        : hexToRgba(palette.textPrimary, 0.62),

      // 外框光暈與框選掃描效果
      '--accent-glow': hexToRgba(palette.accentColor, 0.78),
      '--accent-glow-soft': hexToRgba(palette.accentColor, 0.36),
      '--accent-tint': hexToRgba(palette.accentColor, isLight ? 0.12 : 0.14),
      '--accent-border': hexToRgba(palette.accentColor, isLight ? 0.45 : 0.5),
      '--scan-gradient': `linear-gradient(90deg, transparent, ${palette.accentColor}, ${palette.accentSecondary}, transparent)`,

      // 設定頁與覆蓋層卡片、輸入框底色
      '--card-bg': isLight ? hexToRgba(palette.bgSurface, 0.97) : hexToRgba(palette.bgPrimary, 0.95),
      '--card-bg-solid': isLight ? palette.bgSurface : palette.bgPrimary,
      '--topbar-bg': isLight ? hexToRgba(palette.bgSurface, 0.94) : hexToRgba(palette.bgPrimary, 0.88),
      '--sub-panel-bg': isLight ? hexToRgba(palette.bgPrimary, 0.92) : hexToRgba(palette.bgSurface, 0.88),
      '--input-bg': palette.bgPrimary,
      '--overlay-input-bg': isLight ? palette.bgPrimary : hexToRgba(palette.bgSurface, 0.92),
      '--border-subtle': isLight
        ? hexToRgba(palette.textPrimary, 0.18)
        : hexToRgba(palette.textPrimary, 0.24),
      '--border-faint': isLight
        ? hexToRgba(palette.textPrimary, 0.12)
        : hexToRgba(palette.textPrimary, 0.16),

      // 次要按鈕、主漸層按鈕與發音中狀態
      '--btn-bg': isLight
        ? hexToRgba(palette.textPrimary, 0.08)
        : hexToRgba(palette.textPrimary, 0.16),
      '--btn-hover-bg': isLight
        ? hexToRgba(palette.textPrimary, 0.15)
        : hexToRgba(palette.textPrimary, 0.26),
      '--btn-text': palette.textPrimary,
      '--btn-primary-bg': `linear-gradient(135deg, ${primaryGradStart}, ${palette.accentSecondary})`,
      '--btn-primary-text': primaryBtnText,
      '--btn-primary-shadow': hexToRgba(palette.accentSecondary, 0.35),
      '--speaking-bg': hexToRgba(palette.accentColor, isLight ? 0.18 : 0.28),
      '--speaking-border': hexToRgba(palette.accentColor, 0.72),
      '--speaking-text': isLight ? palette.accentColor : palette.textPrimary,

      // 查找與翻譯對話面板（標頭、快速提問 Chips、使用者與 AI 氣泡、程式碼區）
      '--gemini-header-bg': `linear-gradient(90deg, ${hexToRgba(primaryGradStart, isLight ? 0.16 : 0.28)}, ${hexToRgba(palette.accentSecondary, isLight ? 0.16 : 0.28)})`,
      '--gemini-title-color': isLight ? palette.textPrimary : palette.textPrimary,
      '--chip-bg': hexToRgba(palette.accentColor, isLight ? 0.12 : 0.18),
      '--chip-border': hexToRgba(palette.accentColor, isLight ? 0.36 : 0.38),
      '--chip-text': isLight ? palette.accentColor : palette.textPrimary,
      '--chip-hover-bg': hexToRgba(palette.accentColor, isLight ? 0.24 : 0.38),
      '--msg-user-bg': userBubbleBg,
      '--msg-user-text': userBubbleText,
      '--msg-model-bg': isLight ? palette.bgPrimary : hexToRgba(palette.bgSurface, 0.95),
      '--msg-model-text': palette.textPrimary,
      '--code-bg': isLight
        ? hexToRgba(palette.textPrimary, 0.08)
        : hexToRgba(palette.bgPrimary, 0.85),

      // 狀態徽章、陰影與強調資訊文字
      '--shadow-elevated': isLight
        ? '0 16px 40px rgba(15, 23, 42, 0.16)'
        : '0 18px 46px rgba(0, 0, 0, 0.58)',
      '--shadow-soft': isLight
        ? '0 8px 24px rgba(15, 23, 42, 0.12)'
        : '0 10px 28px rgba(0, 0, 0, 0.45)',
      '--badge-ok-bg': isLight ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.14)',
      '--badge-ok-border': isLight ? 'rgba(5, 150, 105, 0.4)' : 'rgba(52, 211, 153, 0.45)',
      '--badge-ok-text': isLight ? '#047857' : '#6ee7b7',
      '--badge-warn-bg': isLight ? 'rgba(245, 158, 11, 0.14)' : 'rgba(245, 158, 11, 0.16)',
      '--badge-warn-border': isLight ? 'rgba(217, 119, 6, 0.45)' : 'rgba(251, 191, 36, 0.52)',
      '--badge-warn-text': isLight ? '#b45309' : '#fde68a',
      '--badge-portable-bg': hexToRgba(palette.accentSecondary, isLight ? 0.12 : 0.2),
      '--badge-portable-border': hexToRgba(palette.accentSecondary, 0.45),
      '--badge-portable-text': isLight ? palette.accentSecondary : palette.textPrimary
    };

    return {
      presetId,
      name: isCustom ? '🎨 自訂配色' : basePreset.name,
      isLight,
      palette,
      cssVars
    };
  }

  /**
   * 將計算出的主題 CSS 變數套用至指定根節點（預設為 document.documentElement）
   * @param {object} settings - 應用程式設定物件
   * @param {HTMLElement} [rootEl] - 欲套用 CSS 變數的 DOM 元素
   * @returns {object} 已套用的主題 Token 物件
   */
  function applyThemeToDocument(settings, rootEl) {
    const tokens = resolveThemeTokens(settings);
    const target = rootEl || (typeof document !== 'undefined' ? document.documentElement : null);

    if (target && target.style && typeof target.style.setProperty === 'function') {
      const entries = Object.entries(tokens.cssVars);
      for (let i = 0; i < entries.length; i++) {
        const [prop, value] = entries[i];
        target.style.setProperty(prop, value);
      }
      if (target.dataset) {
        target.dataset.themePreset = tokens.presetId;
        target.dataset.themeMode = tokens.isLight ? 'light' : 'dark';
      }
    }

    return tokens;
  }

  return {
    THEME_PRESETS,
    DEFAULT_CUSTOM_THEME,
    normalizeHex,
    hexToRgb,
    hexToRgba,
    isLightColor,
    resolveThemeTokens,
    applyThemeToDocument
  };
});
