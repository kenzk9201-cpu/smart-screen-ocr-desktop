// preload.js - Electron Renderer 與 Main Process 安全橋接層
// 透過 contextBridge 僅暴露受控的 window.smartOcrApi，確保上下文隔離安全

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 註冊 IPC 事件監聽器並回傳對應的取消監聽函式，避免重複綁定或記憶體洩漏
 * @param {string} channel - IPC 頻道名稱
 * @param {Function} callback - 接收到資料時的回呼函式
 * @returns {Function} 取消監聽函式
 */
function createEventSubscriber(channel, callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  const listener = (_event, payload) => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// 將所有桌面應用程式原生與 AI 能力安全暴露給前端畫面
contextBridge.exposeInMainWorld('smartOcrApi', {
  // 取得目前本機儲存的應用程式設定
  getSettings: () => ipcRenderer.invoke('settings:get'),

  // 儲存設定並即時更新全域快捷鍵與開機自動啟動狀態
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // 取得系統平台、macOS 螢幕錄製權限、應用程式版本與開機啟動狀態
  getSystemInfo: () => ipcRenderer.invoke('system:info'),

  // 開啟 macOS「系統設定 → 隱私權與安全性 → 螢幕錄製」頁面
  openScreenPermissionSettings: () => ipcRenderer.invoke('system:open-screen-permission'),

  // 以系統預設瀏覽器安全開啟外部網址（例如 Google AI Studio）
  openExternalUrl: (url) => ipcRenderer.invoke('system:open-external', url),

  // 立即觸發全螢幕截圖與框選辨識覆蓋層
  triggerCapture: () => ipcRenderer.invoke('capture:trigger'),

  // 關閉目前開啟的截圖覆蓋層視窗
  closeOverlay: () => ipcRenderer.invoke('overlay:close'),

  // 監聽覆蓋層初始化事件（接收底圖、螢幕範圍、設定與平台資訊）
  onOverlayInit: (cb) => createEventSubscriber('overlay:init', cb),

  // 監聽設定更新廣播事件（同步設定視窗與覆蓋層狀態）
  onSettingsUpdated: (cb) => createEventSubscriber('settings:updated', cb),

  // 呼叫 AI 服務進行局部裁切圖片 OCR 文字辨識
  ocrCrop: (imageDataUrl) => ipcRenderer.invoke('ai:ocr-crop', imageDataUrl),

  // 呼叫 AI 服務進行多輪上下文智慧對話
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),

  // 呼叫高品質自然語音合成服務（Edge 自然神經語音 / Google Gemini 官方自然語音）
  synthesizeSpeech: (payload) => ipcRenderer.invoke('tts:synthesize', payload),

  // 取得可用的語音引擎與各語系聲線清單
  getTtsOptions: () => ipcRenderer.invoke('tts:options'),

  // 將文字寫入系統剪貼簿
  copyText: (text) => ipcRenderer.invoke('native:copy-text', text),

  // 透過系統原生儲存對話框另存裁切圖片至本機磁碟
  saveImage: (payload) => ipcRenderer.invoke('native:save-image', payload),

  // 開啟或聚焦獨立設定視窗
  openSettingsWindow: () => ipcRenderer.invoke('window:open-settings')
});
