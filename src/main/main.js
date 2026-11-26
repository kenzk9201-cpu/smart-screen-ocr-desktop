// main.js - Smart Screen OCR 跨平台 Electron 主程序
// 負責單一實例管理、系統常駐列 (Tray)、全域快捷鍵、跨平台多螢幕凍結截圖覆蓋層與所有 IPC 服務

'use strict';

const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  desktopCapturer,
  screen,
  ipcMain,
  clipboard,
  dialog,
  shell,
  nativeImage,
  systemPreferences
} = require('electron');

const { createSettingsStore, DEFAULT_SETTINGS } = require('./settingsStore');
const { toElectronAccelerator, formatShortcutForDisplay, DEFAULT_SHORTCUT } = require('./shortcutHelper');
const { handleCropOCR, handleAIChat, parseDataUrl } = require('./aiService');
const { synthesizeSpeech, getTtsOptions } = require('./ttsService');

// 內建 16x16 藍色漸層降級圖示 (PNG Data URL)，確保外部圖示尚未產生時絕不崩潰
const FALLBACK_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWUlEQVR42mP8z8DwnwEJMDIyMmATZwJiBgZGBjY0s4gBhiH////PwMDA8J8Bkw0MDGDDGRgY/mPzDMP///9BihmINQBsACkGgP2B1wCGUQIwGg0wGg1gAQAAGB8L8f8bN3cAAAAASUVORK5CYII=';

// 偵測是否為自動化煙霧測試模式
const isSmokeTest = process.argv.includes('--smoke-test');

// 全域狀態管理
let settingsStore = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let tray = null;
let settingsWindow = null;
let overlayWindow = null;
let isQuitting = false;
let isCapturing = false;
let activeRegisteredShortcut = '';
let activeRegisteredAccelerator = '';
let lastShortcutError = '';

// 資源與路徑常數
const ROOT_DIR = path.join(__dirname, '..', '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'preload.js');
const OVERLAY_HTML_PATH = path.join(__dirname, '..', 'renderer', 'overlay.html');
const SETTINGS_HTML_PATH = path.join(__dirname, '..', 'renderer', 'settings.html');

/**
 * 單一實例鎖定：防止重複啟動多個應用程式實體
 * 若使用者再次執行程式，將自動喚醒並聚焦既有實例的設定視窗
 */
const gotTheLock = isSmokeTest ? true : app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openSettingsWindow();
  });
}

/**
 * 安全載入圖示檔案；若檔案不存在或載入失敗則優雅降級至內建圖示
 * @param {string[]} candidateFileNames - 依優先順序排列的資產檔名清單
 * @param {{ resize?: { width: number, height: number }, isTemplate?: boolean }} [options]
 * @returns {Electron.NativeImage}
 */
function loadImageWithFallback(candidateFileNames, options = {}) {
  for (const fileName of candidateFileNames) {
    const fullPath = path.join(ASSETS_DIR, fileName);
    try {
      if (fs.existsSync(fullPath)) {
        let img = nativeImage.createFromPath(fullPath);
        if (!img.isEmpty()) {
          if (options.resize) {
            img = img.resize(options.resize);
          }
          if (options.isTemplate && process.platform === 'darwin') {
            img.setTemplateImage(true);
          }
          return img;
        }
      }
    } catch {
      // 忽略單一檔案載入錯誤並嘗試下一個候選檔案
    }
  }

  let fallback = nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
  if (options.resize && !fallback.isEmpty()) {
    fallback = fallback.resize(options.resize);
  }
  if (options.isTemplate && process.platform === 'darwin' && !fallback.isEmpty()) {
    fallback.setTemplateImage(true);
  }
  return fallback;
}

/**
 * 載入系統匣 / 選單列專用圖示
 * @returns {Electron.NativeImage}
 */
function loadTrayIcon() {
  if (process.platform === 'darwin') {
    // macOS 優先使用單色 Template 圖示以自動適配深淺色選單列
    const templatePath = path.join(ASSETS_DIR, 'tray-iconTemplate.png');
    if (fs.existsSync(templatePath)) {
      return loadImageWithFallback(['tray-iconTemplate.png'], { isTemplate: true });
    }
    return loadImageWithFallback(['tray-icon.png', 'icon.png'], {
      resize: { width: 18, height: 18 }
    });
  }

  // Windows / Linux 使用彩色系統匣圖示
  return loadImageWithFallback(['tray-icon.png', 'icon.png'], {
    resize: { width: 16, height: 16 }
  });
}

/**
 * 載入應用程式視窗圖示
 * @returns {Electron.NativeImage}
 */
function loadWindowIcon() {
  return loadImageWithFallback(['icon.png', 'icon.ico', 'tray-icon.png']);
}

/**
 * 取得目前系統的螢幕錄製權限狀態
 * Windows 與 Linux 固定回傳 'granted'；macOS 透過 systemPreferences 查詢實際狀態
 * @returns {string}
 */
function getScreenPermissionStatus() {
  if (process.platform !== 'darwin') {
    return 'granted';
  }
  try {
    return systemPreferences.getMediaAccessStatus('screen') || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 開啟 macOS「系統設定 → 隱私權與安全性 → 螢幕錄製」權限頁面
 */
async function openMacScreenPermissionSettings() {
  if (process.platform !== 'darwin') {
    return { ok: true };
  }
  try {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * 套用開機自動啟動設定
 * 僅在正式打包環境 (app.isPackaged) 寫入系統登入項目，避免開發測試模式汙染系統開機清單
 * @param {boolean} enabled
 */
function applyLoginItemSettings(enabled) {
  try {
    if (!app.isPackaged) {
      return;
    }
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled)
      });
    }
  } catch (err) {
    console.warn('[Main] 設定開機自動啟動失敗:', err.message);
  }
}

/**
 * 取得開機自動啟動啟用狀態
 * @returns {boolean}
 */
function getLoginItemEnabled() {
  try {
    if (app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')) {
      return Boolean(app.getLoginItemSettings().openAtLogin);
    }
  } catch {
    // 若查詢失敗則回退至本機設定檔記錄值
  }
  return Boolean(currentSettings.launchAtLogin);
}

/**
 * 註冊或更新全域快速鍵
 * 若新快捷鍵無效或與其他程式衝突，會自動還原先前有效的快捷鍵並回報錯誤原因
 * @param {string} shortcutString - 目標快捷鍵字串
 * @returns {{ shortcutRegistered: boolean, shortcutError: string }}
 */
function registerGlobalShortcut(shortcutString) {
  const target = (shortcutString || DEFAULT_SHORTCUT).trim();
  const converted = toElectronAccelerator(target, process.platform);

  if (!converted.valid) {
    lastShortcutError = converted.error || '快捷鍵格式無效';
    return {
      shortcutRegistered: false,
      shortcutError: lastShortcutError
    };
  }

  const prevAccelerator = activeRegisteredAccelerator;
  const prevShortcut = activeRegisteredShortcut;

  // 若與目前已註冊的快捷鍵完全相同，直接回傳成功
  if (prevAccelerator && prevAccelerator === converted.accelerator && globalShortcut.isRegistered(prevAccelerator)) {
    lastShortcutError = '';
    return { shortcutRegistered: true, shortcutError: '' };
  }

  // 先解除先前註冊的舊快捷鍵，避免同時保留兩個觸發鍵
  if (prevAccelerator) {
    try {
      globalShortcut.unregister(prevAccelerator);
    } catch {
      // 忽略解除失敗
    }
  }

  let registered = false;
  try {
    registered = globalShortcut.register(converted.accelerator, () => {
      captureAndShowOverlay();
    });
  } catch (err) {
    registered = false;
    lastShortcutError = `註冊快捷鍵失敗：${err.message || String(err)}`;
  }

  if (registered) {
    activeRegisteredShortcut = target;
    activeRegisteredAccelerator = converted.accelerator;
    lastShortcutError = '';
    return { shortcutRegistered: true, shortcutError: '' };
  }

  // 註冊失敗時嘗試恢復先前可用的快捷鍵
  if (prevAccelerator) {
    try {
      const restored = globalShortcut.register(prevAccelerator, () => {
        captureAndShowOverlay();
      });
      if (restored) {
        activeRegisteredShortcut = prevShortcut;
        activeRegisteredAccelerator = prevAccelerator;
      } else {
        activeRegisteredShortcut = '';
        activeRegisteredAccelerator = '';
      }
    } catch {
      activeRegisteredShortcut = '';
      activeRegisteredAccelerator = '';
    }
  }

  lastShortcutError = `無法註冊全域快捷鍵「${target}」，可能已被系統或其他應用程式佔用，請更換其他組合鍵。`;
  return {
    shortcutRegistered: false,
    shortcutError: lastShortcutError
  };
}

/**
 * 廣播最新設定給所有開啟中的視窗（設定視窗、截圖覆蓋層與任何未來視窗），實現主題配色與語音設定即時連動
 * @param {object} settings
 */
function broadcastSettingsUpdated(settings) {
  const allWindows = BrowserWindow.getAllWindows();
  for (const win of allWindows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings:updated', settings);
    }
  }
}

/**
 * 建立或更新系統常駐列 (Windows 系統匣 / macOS 頂部選單列)
 */
function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) {
    return;
  }

  const displayShortcut = formatShortcutForDisplay(
    currentSettings.customShortcut || DEFAULT_SHORTCUT,
    process.platform
  );

  const tooltip = process.platform === 'win32'
    ? `Smart Screen OCR (${displayShortcut})\n左鍵點擊立即截圖｜雙擊開啟設定｜右鍵開啟選單`
    : `Smart Screen OCR (${displayShortcut})`;
  tray.setToolTip(tooltip);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `✨ 擷取螢幕畫面 (${displayShortcut})`,
      click: () => {
        captureAndShowOverlay();
      }
    },
    {
      label: '⚙️ 設定與快速鍵',
      click: () => {
        openSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: '🚀 開機自動啟動',
      type: 'checkbox',
      checked: Boolean(currentSettings.launchAtLogin),
      click: (menuItem) => {
        const enabled = Boolean(menuItem.checked);
        currentSettings = settingsStore.save({ launchAtLogin: enabled });
        applyLoginItemSettings(enabled);
        broadcastSettingsUpdated(currentSettings);
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: '❌ 結束程式',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * 初始化系統常駐列圖示與點擊互動行為
 */
function initTray() {
  if (tray && !tray.isDestroyed()) {
    updateTrayMenu();
    return;
  }

  tray = new Tray(loadTrayIcon());
  updateTrayMenu();

  // 在 Windows 系統匣中：單擊左鍵直接觸發截圖，雙擊開啟設定視窗
  if (process.platform === 'win32') {
    tray.on('click', () => {
      captureAndShowOverlay();
    });
    tray.on('double-click', () => {
      openSettingsWindow();
    });
  }
}

/**
 * 開啟或聚焦獨立設定視窗
 */
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 820,
    height: 840,
    minWidth: 640,
    minHeight: 600,
    title: 'Smart Screen OCR - 設定與快速鍵',
    backgroundColor: '#0f172a',
    icon: loadWindowIcon(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 攔截視窗關閉事件：一般關閉時隱藏至系統常駐列背景執行，而非直接結束整個程式
  settingsWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      settingsWindow.hide();
    }
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  settingsWindow.once('ready-to-show', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
      settingsWindow.focus();
    }
  });

  if (fs.existsSync(SETTINGS_HTML_PATH)) {
    settingsWindow.loadFile(SETTINGS_HTML_PATH);
  } else {
    settingsWindow.loadURL('data:text/html;charset=utf-8,<h2>Smart Screen OCR 設定頁面載入中</h2>');
  }

  return settingsWindow;
}

/**
 * 安全關閉並清理目前的截圖覆蓋層視窗
 */
function closeOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try {
      overlayWindow.destroy();
    } catch {
      // 忽略視窗已銷毀時的錯誤
    }
  }
  overlayWindow = null;
}

/**
 * 短暫延遲輔助函式（用於等待自身視窗完全隱藏後再擷取乾淨畫面）
 * @param {number} ms - 延遲毫秒數
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 跨平台多螢幕截圖與凍結覆蓋層核心流程
 * 1. macOS 檢查螢幕錄製權限，未授權則引導開啟系統設定
 * 2. 隱藏自身視窗避免入鏡
 * 3. 偵測滑鼠目前所在顯示器並擷取高解析度原始畫面
 * 4. 建立無框全螢幕置頂覆蓋視窗並將凍結底圖傳送給 overlay.html
 */
async function captureAndShowOverlay() {
  if (isCapturing) {
    return { ok: false, error: '截圖流程正在進行中' };
  }
  isCapturing = true;

  try {
    // 1. macOS 螢幕錄製權限預先檢查
    if (process.platform === 'darwin') {
      const permission = getScreenPermissionStatus();
      if (permission !== 'granted') {
        openSettingsWindow();
        const choice = await dialog.showMessageBox(settingsWindow || undefined, {
          type: 'warning',
          title: '需要 macOS 螢幕錄製權限',
          message: 'Smart Screen OCR 需要「螢幕錄製」權限才能擷取螢幕畫面。',
          detail: '請前往「系統設定 → 隱私權與安全性 → 螢幕錄製」，開啟 Smart Screen OCR 後再重新嘗試截圖。',
          buttons: ['前往系統設定', '稍後再說'],
          defaultId: 0,
          cancelId: 1
        });
        if (choice.response === 0) {
          await openMacScreenPermissionSettings();
        }
        return { ok: false, error: 'SCREEN_PERMISSION_DENIED' };
      }
    }

    // 2. 截圖前先關閉既有覆蓋層並隱藏設定視窗，避免應用程式自身出現在截圖內
    let didHideAnyWindow = false;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      closeOverlayWindow();
      didHideAnyWindow = true;
    }
    if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
      settingsWindow.hide();
      didHideAnyWindow = true;
    }
    if (didHideAnyWindow) {
      await delay(160);
    }

    // 3. 偵測滑鼠目前所在螢幕與高解析度縮放倍率
    const cursorPoint = screen.getCursorScreenPoint();
    const targetDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const { bounds, scaleFactor = 1, id: displayId } = targetDisplay;

    const thumbnailWidth = Math.max(1, Math.round(bounds.width * scaleFactor));
    const thumbnailHeight = Math.max(1, Math.round(bounds.height * scaleFactor));

    // 4. 透過 desktopCapturer 擷取螢幕原始高畫質影像
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight }
    });

    if (!sources || sources.length === 0) {
      throw new Error('無法取得任何螢幕畫面來源');
    }

    // 優先比對滑鼠所在顯示器的 display_id；單螢幕或無法對應時取第一張
    const matchedSource =
      sources.find((src) => String(src.display_id) === String(displayId)) || sources[0];
    const screenshotDataUrl = matchedSource.thumbnail.toDataURL();

    // 5. 建立無框全螢幕置頂覆蓋視窗，完整貼合目標顯示器範圍
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#000000',
      show: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    overlayWindow = win;

    // 強制套用精確座標與最高層級置頂（覆蓋 Windows 工作列與 macOS 全螢幕 App）
    win.setBounds(bounds);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    win.on('closed', () => {
      if (overlayWindow === win) {
        overlayWindow = null;
      }
    });

    // 等待覆蓋層畫面載入完成與 ready-to-show，再傳送凍結底圖並瞬間顯示
    let isReadyToShow = false;
    let isInitSent = false;

    const revealOverlayIfReady = () => {
      if (!win.isDestroyed() && isReadyToShow && isInitSent && !win.isVisible()) {
        win.setBounds(bounds);
        win.show();
        win.focus();
      }
    };

    win.once('ready-to-show', () => {
      isReadyToShow = true;
      revealOverlayIfReady();
    });

    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      win.webContents.send('overlay:init', {
        screenshotDataUrl,
        displayBounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          scaleFactor
        },
        settings: currentSettings,
        platform: process.platform
      });
      isInitSent = true;
      // 若 ready-to-show 尚未觸發，稍微保底確保視窗一定會顯示
      revealOverlayIfReady();
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) {
          win.setBounds(bounds);
          win.show();
          win.focus();
        }
      }, 120);
    });

    await win.loadFile(OVERLAY_HTML_PATH);
    return { ok: true };
  } catch (err) {
    console.error('[Main] 截圖或建立覆蓋層失敗:', err);
    closeOverlayWindow();
    return { ok: false, error: err.message || String(err) };
  } finally {
    isCapturing = false;
  }
}

/**
 * 註冊所有主程序 IPC 通訊處理函式，嚴格對齊 preload.js 暴露的合約
 */
function registerIpcHandlers() {
  // 取得設定
  ipcMain.handle('settings:get', async () => {
    currentSettings = settingsStore.load();
    return currentSettings;
  });

  // 儲存設定並即時套用快捷鍵與開機自動啟動
  ipcMain.handle('settings:save', async (_event, newSettings) => {
    try {
      const prevLaunchAtLogin = currentSettings.launchAtLogin;
      currentSettings = settingsStore.save(newSettings);

      const shortcutResult = registerGlobalShortcut(currentSettings.customShortcut);

      if (currentSettings.launchAtLogin !== prevLaunchAtLogin) {
        applyLoginItemSettings(currentSettings.launchAtLogin);
      }

      updateTrayMenu();
      broadcastSettingsUpdated(currentSettings);

      return {
        ok: true,
        settings: currentSettings,
        shortcutRegistered: shortcutResult.shortcutRegistered,
        shortcutError: shortcutResult.shortcutError
      };
    } catch (err) {
      return {
        ok: false,
        settings: currentSettings,
        shortcutRegistered: false,
        shortcutError: err.message || String(err)
      };
    }
  });

  // 取得系統平台、權限、版本與行動免安裝模式資訊
  ipcMain.handle('system:info', async () => {
    return {
      platform: process.platform,
      screenPermission: getScreenPermissionStatus(),
      appVersion: app.getVersion(),
      loginItemEnabled: getLoginItemEnabled(),
      shortcutRegistered: Boolean(activeRegisteredAccelerator),
      shortcutError: lastShortcutError,
      isPortable: Boolean(settingsStore && settingsStore.isPortableMode()),
      settingsFilePath: settingsStore ? settingsStore.getFilePath() : ''
    };
  });

  // 開啟 macOS 螢幕錄製權限系統設定
  ipcMain.handle('system:open-screen-permission', async () => {
    return openMacScreenPermissionSettings();
  });

  // 以系統預設瀏覽器開啟外部連結（僅允許 http/https 協定以確保安全）
  ipcMain.handle('system:open-external', async (_event, url) => {
    try {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
        return { ok: false, error: '僅允許開啟 HTTP 或 HTTPS 外部網址' };
      }
      await shell.openExternal(url.trim());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // 觸發螢幕截圖與覆蓋層
  ipcMain.handle('capture:trigger', async () => {
    return captureAndShowOverlay();
  });

  // 關閉截圖覆蓋層
  ipcMain.handle('overlay:close', async () => {
    closeOverlayWindow();
    return { ok: true };
  });

  // 執行局部裁切圖片 OCR 文字辨識
  ipcMain.handle('ai:ocr-crop', async (_event, imageDataUrl) => {
    try {
      const data = await handleCropOCR(imageDataUrl, currentSettings);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // 執行懸浮視窗 AI 智慧對話
  ipcMain.handle('ai:chat', async (_event, payload) => {
    try {
      const data = await handleAIChat(payload, currentSettings);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // 執行高品質自然語音合成（Edge 自然神經語音 / Google Gemini 官方自然語音）
  ipcMain.handle('tts:synthesize', async (_event, payload) => {
    try {
      return await synthesizeSpeech(payload, currentSettings);
    } catch (err) {
      return {
        ok: false,
        error: err.message || String(err),
        fallbackToLocal: true
      };
    }
  });

  // 取得可用語音引擎與聲線清單
  ipcMain.handle('tts:options', async () => {
    return getTtsOptions();
  });

  // 寫入系統剪貼簿
  ipcMain.handle('native:copy-text', async (_event, text) => {
    try {
      clipboard.writeText(typeof text === 'string' ? text : String(text || ''));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // 另存裁切圖片至本機磁碟（顯示系統原生儲存對話框）
  ipcMain.handle('native:save-image', async (event, payload) => {
    const { dataUrl, defaultFileName } = payload || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return { ok: false, canceled: false, error: '缺少有效的圖片資料' };
    }

    const parentWin = BrowserWindow.fromWebContents(event.sender) || overlayWindow || settingsWindow;
    const isOverlayParent = Boolean(parentWin && parentWin === overlayWindow && !parentWin.isDestroyed());

    try {
      const { mimeType, base64Data } = parseDataUrl(dataUrl);
      const defaultExt = mimeType.includes('png') ? 'png' : 'jpg';
      const fallbackName = `smart-ocr-${Date.now()}.${defaultExt}`;
      const targetName = (typeof defaultFileName === 'string' && defaultFileName.trim())
        ? defaultFileName.trim()
        : fallbackName;

      // 若由置頂覆蓋層觸發對話框，暫時降低置頂層級以避免系統對話框被蓋住
      if (isOverlayParent) {
        parentWin.setAlwaysOnTop(false);
      }

      const saveResult = await dialog.showSaveDialog(parentWin || undefined, {
        title: '另存截圖圖片',
        defaultPath: path.join(app.getPath('pictures'), targetName),
        filters: [
          { name: 'JPEG 圖片 (*.jpg)', extensions: ['jpg', 'jpeg'] },
          { name: 'PNG 圖片 (*.png)', extensions: ['png'] },
          { name: '所有檔案', extensions: ['*'] }
        ]
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { ok: false, canceled: true };
      }

      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(saveResult.filePath, buffer);
      return { ok: true, filePath: saveResult.filePath };
    } catch (err) {
      return { ok: false, canceled: false, error: err.message || String(err) };
    } finally {
      if (isOverlayParent && !parentWin.isDestroyed()) {
        parentWin.setAlwaysOnTop(true, 'screen-saver');
        parentWin.focus();
      }
    }
  });

  // 開啟獨立設定視窗（若覆蓋層正在顯示則先關閉覆蓋層，避免遮擋設定視窗）
  ipcMain.handle('window:open-settings', async () => {
    closeOverlayWindow();
    openSettingsWindow();
    return { ok: true };
  });
}

/**
 * 自動化煙霧測試流程 (--smoke-test)
 * 驗證主程序設定載入、IPC 註冊、快捷鍵轉換與 Preload 檔案存在性，並於 1.5 秒內乾淨退出
 */
function runSmokeTest() {
  try {
    settingsStore = createSettingsStore();
    currentSettings = settingsStore.load();
    registerIpcHandlers();

    const shortcutCheck = toElectronAccelerator(
      currentSettings.customShortcut || DEFAULT_SHORTCUT,
      process.platform
    );
    if (!shortcutCheck.valid) {
      throw new Error(`預設快捷鍵驗證失敗: ${shortcutCheck.error}`);
    }

    if (!fs.existsSync(PRELOAD_PATH)) {
      throw new Error(`找不到 Preload 腳本: ${PRELOAD_PATH}`);
    }

    // 確認語音選項與設定路徑皆可正常初始化
    const ttsOpts = getTtsOptions();
    if (!ttsOpts || !Array.isArray(ttsOpts.engines) || ttsOpts.engines.length < 3) {
      throw new Error('語音引擎選項初始化異常');
    }

    // 確認系統匣降級圖示可正常建立
    const trayImg = loadTrayIcon();
    if (trayImg.isEmpty()) {
      throw new Error('系統匣圖示載入失敗');
    }

    console.log('SMOKE_TEST_OK');
    setTimeout(() => {
      app.exit(0);
    }, 150);
  } catch (err) {
    console.error('[SmokeTest] 煙霧測試失敗:', err);
    app.exit(1);
  }
}

// 應用程式就緒後啟動主程序服務
app.whenReady().then(() => {
  if (isSmokeTest) {
    runSmokeTest();
    return;
  }

  settingsStore = createSettingsStore();
  currentSettings = settingsStore.load();

  registerIpcHandlers();
  registerGlobalShortcut(currentSettings.customShortcut);
  applyLoginItemSettings(currentSettings.launchAtLogin);
  initTray();

  // 首次啟動或手動開啟時顯示設定儀表板，方便檢視快捷鍵與填寫 API Key
  openSettingsWindow();

  // macOS 點擊 Dock 圖示時重新顯示設定視窗
  app.on('activate', () => {
    openSettingsWindow();
  });
});

// 所有視窗關閉時維持系統常駐列執行，不結束程式
app.on('window-all-closed', () => {
  // 故意留空，讓程式持續在系統匣 / 選單列待命監聽全域快捷鍵
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    // 忽略退出時的清理錯誤
  }
});
