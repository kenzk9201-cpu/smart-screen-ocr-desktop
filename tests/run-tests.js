/**
 * Smart Screen OCR Desktop - 完整自動化測試與合規驗證套件
 * 使用 Node.js 內建模組 (assert / fs / path / crypto / os)，不依賴任何外部測試框架。
 * 執行方式：npm test (node tests/run-tests.js)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const WORKSPACE_DIR = path.resolve(ROOT_DIR, '..');
const ORIGINAL_EXT_DIR = path.join(WORKSPACE_DIR, 'smart-screen-ocr-gemini');

// 測試結果統計器
const results = [];

/**
 * 執行單一測試案例並記錄結果（支援同步與非同步函式）
 * @param {string} category 測試分類名稱
 * @param {string} name 測試項目名稱
 * @param {Function} fn 測試函式
 */
async function runTest(category, name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ category, name, passed: true, ms });
    console.log(`  ✅ [${category}] ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ category, name, passed: false, ms, error: err.message || String(err) });
    console.error(`  ❌ [${category}] ${name} (${ms}ms)`);
    console.error(`     ↳ ${err.message || err}`);
  }
}

/**
 * 計算檔案的 SHA-256 雜湊值（大寫十六進位）
 * @param {string} filePath 檔案絕對路徑
 * @returns {string}
 */
function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
}

/**
 * 建立暫存測試用資料夾
 * @param {string} prefix 目錄前綴
 * @returns {string}
 */
function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * 遞迴列出專案內所有文字檔（排除 node_modules、dist、.git 與二進位檔）
 * @param {string} dir 起始目錄
 * @returns {string[]}
 */
function collectTextFiles(dir) {
  const ignoredDirs = new Set(['node_modules', 'dist', '.git', 'out']);
  const textExts = new Set(['.js', '.html', '.css', '.json', '.yml', '.yaml', '.plist', '.md', '.bat', '.command', '.sh', '.txt']);
  const files = [];

  function walk(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (textExts.has(ext)) files.push(full);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * 載入 settingsStore 模組並提供統一操作轉接器（相容函式匯出與類別匯出）
 * @param {string} filePath 設定檔路徑
 */
function createStoreAdapter(filePath) {
  const mod = require(path.join(ROOT_DIR, 'src/main/settingsStore.js'));
  if (typeof mod.createSettingsStore === 'function') {
    return mod.createSettingsStore(filePath);
  }
  if (typeof mod.SettingsStore === 'function') {
    return new mod.SettingsStore(filePath);
  }
  if (typeof mod === 'function') {
    return new mod(filePath);
  }
  if (typeof mod.loadSettings === 'function' && typeof mod.saveSettings === 'function') {
    return {
      load: () => mod.loadSettings(filePath),
      save: (data) => mod.saveSettings(data, filePath),
      getDefaults: () => (mod.DEFAULT_SETTINGS ? { ...mod.DEFAULT_SETTINGS } : mod.loadSettings(filePath))
    };
  }
  throw new Error(`無法辨識 settingsStore.js 匯出介面，目前 keys: ${Object.keys(mod).join(', ')}`);
}

/**
 * 呼叫 shortcutHelper 轉換函式（相容常見匯出名稱）
 * @param {string} shortcut 使用者輸入快捷鍵
 * @param {string} platform 目標作業系統 ('win32' | 'darwin')
 */
function invokeShortcutConvert(mod, shortcut, platform) {
  const fn =
    mod.toElectronAccelerator ||
    mod.normalizeShortcut ||
    mod.convertToAccelerator ||
    mod.parseShortcut ||
    mod.shortcutToAccelerator;
  if (typeof fn !== 'function') {
    throw new Error(`找不到快捷鍵轉換函式，shortcutHelper.js 匯出 keys: ${Object.keys(mod).join(', ')}`);
  }
  return fn(shortcut, platform);
}

// ============================================================================
// 1. 設定持久化測試 (settingsStore.js)
// ============================================================================
async function testSettingsStore() {
  const cat = '設定持久化';

  await runTest(cat, '預設設定值符合規格 (gemini-2.5-flash-lite / Alt+Shift+S)', () => {
    const tmpDir = createTempDir('smart-ocr-store-');
    const filePath = path.join(tmpDir, 'settings.json');
    try {
      const store = createStoreAdapter(filePath);
      const settings = typeof store.getSettings === 'function' ? store.getSettings() : store.load();
      assert.strictEqual(settings.geminiModel, 'gemini-2.5-flash-lite', '預設模型必須為 gemini-2.5-flash-lite');
      assert.strictEqual(settings.customShortcut, 'Alt+Shift+S', '預設快速鍵必須為 Alt+Shift+S');
      assert.strictEqual(settings.openaiBaseUrl, 'https://api.openai.com/v1', '預設 OpenAI Base URL 錯誤');
      assert.strictEqual(settings.customProvider, 'auto', '預設 customProvider 必須為 auto');
      assert.strictEqual(settings.launchAtLogin, false, '預設 launchAtLogin 必須為 false');
      assert.strictEqual(settings.speechRate, 1.0, '預設 speechRate 必須為 1.0');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await runTest(cat, '寫入設定後重新讀取能完整持久化', () => {
    const tmpDir = createTempDir('smart-ocr-store-');
    const filePath = path.join(tmpDir, 'nested', 'settings.json');
    try {
      const store1 = createStoreAdapter(filePath);
      const payload = {
        geminiApiKey: 'AIzaSyTestKey123',
        openaiApiKey: 'sk-test-openai',
        openaiBaseUrl: 'https://example.com/v1',
        geminiModel: 'gemini-4.0-flash',
        customModelId: 'my-custom-v1',
        customProvider: 'openai',
        customShortcut: 'Ctrl+Shift+O',
        launchAtLogin: true,
        speechRate: 1.25,
        preferredVoiceName: 'Google 國語（臺灣）'
      };
      if (typeof store1.saveSettings === 'function') store1.saveSettings(payload);
      else store1.save(payload);

      assert.ok(fs.existsSync(filePath), 'settings.json 檔案應該被建立');

      const store2 = createStoreAdapter(filePath);
      const loaded = typeof store2.getSettings === 'function' ? store2.getSettings() : store2.load();
      assert.strictEqual(loaded.geminiApiKey, 'AIzaSyTestKey123');
      assert.strictEqual(loaded.openaiApiKey, 'sk-test-openai');
      assert.strictEqual(loaded.geminiModel, 'gemini-4.0-flash');
      assert.strictEqual(loaded.customShortcut, 'Ctrl+Shift+O');
      assert.strictEqual(loaded.launchAtLogin, true);
      assert.strictEqual(loaded.speechRate, 1.25);
      assert.strictEqual(loaded.preferredVoiceName, 'Google 國語（臺灣）');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await runTest(cat, '設定檔為異常損毀 JSON 時能優雅容錯並回退預設值', () => {
    const tmpDir = createTempDir('smart-ocr-store-');
    const filePath = path.join(tmpDir, 'corrupt.json');
    try {
      fs.writeFileSync(filePath, '{ invalid json !!! [', 'utf8');
      const store = createStoreAdapter(filePath);
      const loaded = typeof store.getSettings === 'function' ? store.getSettings() : store.load();
      assert.strictEqual(loaded.geminiModel, 'gemini-2.5-flash-lite');
      assert.strictEqual(loaded.customShortcut, 'Alt+Shift+S');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}

// ============================================================================
// 2. 快捷鍵轉換測試 (shortcutHelper.js)
// ============================================================================
async function testShortcutHelper() {
  const cat = '快捷鍵轉換';

  await runTest(cat, 'Windows 快捷鍵轉換正確 (Ctrl/Alt/Shift/F8/Space)', () => {
    const mod = require(path.join(ROOT_DIR, 'src/main/shortcutHelper.js'));

    const r1 = invokeShortcutConvert(mod, 'Alt+Shift+S', 'win32');
    const a1 = typeof r1 === 'string' ? r1 : r1.accelerator;
    assert.strictEqual(a1, 'Alt+Shift+S');

    const r2 = invokeShortcutConvert(mod, 'Ctrl+Shift+S', 'win32');
    const a2 = typeof r2 === 'string' ? r2 : r2.accelerator;
    assert.ok(/^(Control|CommandOrControl)\+Shift\+S$/.test(a2), `預期 Control+Shift+S，實際: ${a2}`);

    const r3 = invokeShortcutConvert(mod, 'F8', 'win32');
    const a3 = typeof r3 === 'string' ? r3 : r3.accelerator;
    assert.strictEqual(a3, 'F8');

    const r4 = invokeShortcutConvert(mod, 'Ctrl+Space', 'win32');
    const a4 = typeof r4 === 'string' ? r4 : r4.accelerator;
    assert.ok(/^(Control|CommandOrControl)\+Space$/.test(a4), `預期 Control+Space，實際: ${a4}`);
  });

  await runTest(cat, 'macOS 快捷鍵轉換正確 (Meta -> Command)', () => {
    const mod = require(path.join(ROOT_DIR, 'src/main/shortcutHelper.js'));

    const r1 = invokeShortcutConvert(mod, 'Meta+Shift+S', 'darwin');
    const a1 = typeof r1 === 'string' ? r1 : r1.accelerator;
    assert.ok(/^(Command|Cmd|CommandOrControl)\+Shift\+S$/.test(a1), `macOS Meta 應轉為 Command，實際: ${a1}`);

    const r2 = invokeShortcutConvert(mod, 'Meta+Shift+S', 'win32');
    const a2 = typeof r2 === 'string' ? r2 : r2.accelerator;
    assert.ok(/^(Super|Meta)\+Shift\+S$/.test(a2), `Windows Meta 應轉為 Super，實際: ${a2}`);
  });

  await runTest(cat, '無效快捷鍵（空值、純修飾鍵、單一普通鍵）應被拒絕', () => {
    const mod = require(path.join(ROOT_DIR, 'src/main/shortcutHelper.js'));
    const invalidInputs = ['', '   ', 'Ctrl', 'Alt+Shift', 'A', 'Ctrl+'];

    for (const input of invalidInputs) {
      let rejected = false;
      try {
        const res = invokeShortcutConvert(mod, input, 'win32');
        if (!res || res === '' || (typeof res === 'object' && res.valid === false) || (typeof res === 'object' && !res.accelerator)) {
          rejected = true;
        }
      } catch {
        rejected = true;
      }
      assert.ok(rejected, `無效快捷鍵 "${input}" 應該被拒絕`);
    }
  });
}

// ============================================================================
// 3. AI 服務測試 (aiService.js)
// ============================================================================
async function testAiService() {
  const cat = 'AI 服務';
  const sampleImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /**
   * 建構簡易 mock fetch 回應物件
   */
  function makeMockResponse(status, bodyObj) {
    const textBody = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => textBody,
      json: async () => JSON.parse(textBody)
    };
  }

  await runTest(cat, 'Gemini 2.5 Flash OCR 自動設定 thinkingBudget: 0 並正確回傳辨識文字', async () => {
    const ai = require(path.join(ROOT_DIR, 'src/main/aiService.js'));
    let capturedUrl = '';
    let capturedBody = null;

    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return makeMockResponse(200, {
        candidates: [{ content: { parts: [{ text: 'Hello 繁體中文 OCR' }] } }]
      });
    };

    const settings = {
      geminiApiKey: 'AIza-Test-25',
      geminiModel: 'gemini-2.5-flash-lite',
      customModelId: '',
      customProvider: 'auto'
    };

    const res = await ai.handleCropOCR(sampleImg, settings, { fetchImpl: mockFetch });
    assert.strictEqual(res.text, 'Hello 繁體中文 OCR');
    assert.ok(capturedUrl.includes('gemini-2.5-flash-lite:generateContent'), `端點錯誤: ${capturedUrl}`);
    assert.ok(capturedUrl.includes('key=AIza-Test-25'), '端點未帶入 API Key');
    assert.strictEqual(capturedBody.generationConfig?.thinkingConfig?.thinkingBudget, 0, 'Gemini 2.5 Flash 必須設定 thinkingBudget: 0');
  });

  await runTest(cat, 'Gemini 4.0 模型正常呼叫 Gemini API 且不強制加 2.5 thinkingBudget', async () => {
    const ai = require(path.join(ROOT_DIR, 'src/main/aiService.js'));
    let capturedUrl = '';
    let capturedBody = null;

    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return makeMockResponse(200, {
        candidates: [{ content: { parts: [{ text: 'Gemini 4.0 結果' }] } }]
      });
    };

    const settings = {
      geminiApiKey: 'AIza-Test-40',
      geminiModel: 'gemini-4.0-hydrogen',
      customModelId: '',
      customProvider: 'auto'
    };

    const res = await ai.handleCropOCR(sampleImg, settings, { fetchImpl: mockFetch });
    assert.strictEqual(res.text, 'Gemini 4.0 結果');
    assert.ok(capturedUrl.includes('gemini-4.0-hydrogen:generateContent'));
    assert.strictEqual(capturedBody.generationConfig?.thinkingConfig, undefined, '非 2.5 Flash 模型不應加入 thinkingConfig');
  });

  await runTest(cat, 'OpenAI 相容端點 (gpt-4o-mini + 自訂 Base URL) 正確傳送 Bearer Token 與圖片', async () => {
    const ai = require(path.join(ROOT_DIR, 'src/main/aiService.js'));
    let capturedUrl = '';
    let capturedHeaders = null;
    let capturedBody = null;

    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      capturedBody = JSON.parse(opts.body);
      return makeMockResponse(200, {
        choices: [{ message: { content: 'OpenAI OCR 文字' } }]
      });
    };

    const settings = {
      openaiApiKey: 'sk-custom-key',
      openaiBaseUrl: 'https://my-proxy.local/v1/',
      geminiModel: 'gpt-4o-mini',
      customModelId: '',
      customProvider: 'auto'
    };

    const res = await ai.handleCropOCR(sampleImg, settings, { fetchImpl: mockFetch });
    assert.strictEqual(res.text, 'OpenAI OCR 文字');
    assert.strictEqual(capturedUrl, 'https://my-proxy.local/v1/chat/completions');
    assert.strictEqual(capturedHeaders.Authorization, 'Bearer sk-custom-key');
    assert.strictEqual(capturedBody.model, 'gpt-4o-mini');
  });

  await runTest(cat, '自訂模型 ID (__custom__) 正確切換供應商與模型名稱', async () => {
    const ai = require(path.join(ROOT_DIR, 'src/main/aiService.js'));
    let capturedModel = '';
    let capturedUrl = '';

    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedModel = JSON.parse(opts.body).model || '';
      return makeMockResponse(200, {
        choices: [{ message: { content: 'Custom OK' } }]
      });
    };

    const settings = {
      openaiApiKey: 'sk-custom-2',
      openaiBaseUrl: 'https://api.openai.com/v1',
      geminiModel: '__custom__',
      customModelId: 'my-local-vlm',
      customProvider: 'openai'
    };

    const res = await ai.handleCropOCR(sampleImg, settings, { fetchImpl: mockFetch });
    assert.strictEqual(res.text, 'Custom OK');
    assert.strictEqual(capturedModel, 'my-local-vlm');
    assert.ok(capturedUrl.endsWith('/chat/completions'));
  });

  await runTest(cat, '缺少 API Key 時回傳標準錯誤碼 (NO_API_KEY / NO_OPENAI_API_KEY)', async () => {
    const ai = require(path.join(ROOT_DIR, 'src/main/aiService.js'));

    await assert.rejects(
      () => ai.handleCropOCR(sampleImg, { geminiApiKey: '', geminiModel: 'gemini-2.5-flash-lite' }, { fetchImpl: async () => { throw new Error('不應呼叫 fetch'); } }),
      (err) => err.message === 'NO_API_KEY',
      '缺少 Gemini Key 必須拋出 NO_API_KEY'
    );

    await assert.rejects(
      () => ai.handleCropOCR(sampleImg, { openaiApiKey: '', geminiModel: 'gpt-4o-mini' }, { fetchImpl: async () => { throw new Error('不應呼叫 fetch'); } }),
      (err) => err.message === 'NO_OPENAI_API_KEY',
      '缺少 OpenAI Key 必須拋出 NO_OPENAI_API_KEY'
    );
  });

  await runTest(cat, '多輪對話歷史組裝正確 (Gemini 與 OpenAI 皆支援上下文與追問)', async () => {
    const ai = require(path.join(ROOT_DIR, 'src/main/aiService.js'));

    // 1. 驗證 Gemini 多輪對話組裝
    let geminiPayload = null;
    const mockGeminiFetch = async (_url, opts) => {
      geminiPayload = JSON.parse(opts.body);
      return makeMockResponse(200, {
        candidates: [{ content: { parts: [{ text: 'Gemini 第二輪回答' }] } }]
      });
    };

    const chatPayload = {
      selectedText: 'Electron Desktop OCR',
      croppedImageDataUrl: sampleImg,
      history: [
        { role: 'user', text: '請解釋這段文字' },
        { role: 'model', text: '這是桌面版截圖辨識工具。' }
      ],
      userPrompt: '請翻譯成日文'
    };

    const gRes = await ai.handleAIChat(
      chatPayload,
      { geminiApiKey: 'AIza-Chat', geminiModel: 'gemini-2.5-flash-lite' },
      { fetchImpl: mockGeminiFetch }
    );
    assert.strictEqual(gRes.reply, 'Gemini 第二輪回答');
    assert.strictEqual(geminiPayload.contents.length, 3, 'Gemini contents 應有 3 輪 (2 歷史 + 1 新提問)');
    assert.strictEqual(geminiPayload.contents[0].role, 'user');
    assert.strictEqual(geminiPayload.contents[1].role, 'model');
    assert.strictEqual(geminiPayload.contents[2].role, 'user');
    assert.ok(geminiPayload.contents[0].parts.some((p) => p.inlineData), '第一輪應夾帶裁切圖片');
    assert.ok(geminiPayload.systemInstruction?.parts?.[0]?.text?.includes('繁體中文'), '系統提示應指定繁體中文');

    // 2. 驗證 OpenAI 多輪對話組裝
    let openaiPayload = null;
    const mockOpenAiFetch = async (_url, opts) => {
      openaiPayload = JSON.parse(opts.body);
      return makeMockResponse(200, {
        choices: [{ message: { content: 'OpenAI 第二輪回答' } }]
      });
    };

    const oRes = await ai.handleAIChat(
      chatPayload,
      { openaiApiKey: 'sk-Chat', openaiBaseUrl: 'https://api.openai.com/v1', geminiModel: 'gpt-4.1-nano' },
      { fetchImpl: mockOpenAiFetch }
    );
    assert.strictEqual(oRes.reply, 'OpenAI 第二輪回答');
    assert.strictEqual(openaiPayload.messages.length, 4, 'OpenAI messages 應有 4 則 (1 system + 2 歷史 + 1 新提問)');
    assert.strictEqual(openaiPayload.messages[0].role, 'system');
    assert.strictEqual(openaiPayload.messages[2].role, 'assistant', 'model 角色應對應轉換為 assistant');
  });
}

// ============================================================================
// 4. IPC 合約一致性靜態檢查
// ============================================================================
async function testIpcContracts() {
  const cat = 'IPC 合約一致性';

  await runTest(cat, 'preload.js 暴露之 smartOcrApi 完整涵蓋 16 個必備方法（含語音合成與選項）', () => {
    const preloadPath = path.join(ROOT_DIR, 'src/preload/preload.js');
    const code = fs.readFileSync(preloadPath, 'utf8');

    assert.ok(code.includes("exposeInMainWorld('smartOcrApi'") || code.includes('exposeInMainWorld("smartOcrApi"'), '必須透過 contextBridge 暴露 smartOcrApi');

    const requiredMethods = [
      'getSettings',
      'saveSettings',
      'getSystemInfo',
      'openScreenPermissionSettings',
      'openExternalUrl',
      'triggerCapture',
      'closeOverlay',
      'onOverlayInit',
      'onSettingsUpdated',
      'ocrCrop',
      'aiChat',
      'copyText',
      'saveImage',
      'openSettingsWindow',
      'synthesizeSpeech',
      'getTtsOptions'
    ];

    for (const method of requiredMethods) {
      const regex = new RegExp(`\\b${method}\\s*[:(]`);
      assert.ok(regex.test(code), `preload.js 缺少 smartOcrApi.${method}`);
    }
  });

  await runTest(cat, '每個 ipcRenderer.invoke/on 通道皆在 main.js 有對應 handle/send', () => {
    const preloadCode = fs.readFileSync(path.join(ROOT_DIR, 'src/preload/preload.js'), 'utf8');
    const mainCode = fs.readFileSync(path.join(ROOT_DIR, 'src/main/main.js'), 'utf8');

    // 擷取所有 invoke 通道
    const invokeChannels = [...preloadCode.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(invokeChannels.length >= 14, `invoke 通道數量異常偏少: ${invokeChannels.length}`);

    for (const ch of invokeChannels) {
      const handleRegex = new RegExp(`ipcMain\\.handle\\(\\s*['"]${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
      assert.ok(handleRegex.test(mainCode), `main.js 缺少對應的 ipcMain.handle('${ch}')`);
    }

    // 擷取所有 on 監聽通道（支援直接呼叫 ipcRenderer.on 與封裝函式 createEventSubscriber）
    const onChannels = [
      ...[...preloadCode.matchAll(/ipcRenderer\.on\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...preloadCode.matchAll(/createEventSubscriber\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
    ];
    assert.ok(onChannels.length >= 2, `on 監聽通道數量異常偏少: ${onChannels.length}`);

    for (const ch of onChannels) {
      const sendRegex = new RegExp(`\\.send\\(\\s*['"]${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
      assert.ok(sendRegex.test(mainCode), `main.js 缺少對應的 webContents.send('${ch}')`);
    }
  });

  await runTest(cat, 'overlay.js 與 settings.js 呼叫之 smartOcrApi.* 方法 100% 存在於 preload.js', () => {
    const preloadCode = fs.readFileSync(path.join(ROOT_DIR, 'src/preload/preload.js'), 'utf8');
    const rendererFiles = [
      path.join(ROOT_DIR, 'src/renderer/overlay.js'),
      path.join(ROOT_DIR, 'src/renderer/settings.js')
    ];

    for (const file of rendererFiles) {
      const code = fs.readFileSync(file, 'utf8');
      const calls = [...code.matchAll(/smartOcrApi\??\.([a-zA-Z0-9_]+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${path.basename(file)} 應該呼叫 window.smartOcrApi`);
      for (const fnName of new Set(calls)) {
        const defRegex = new RegExp(`\\b${fnName}\\s*[:(]`);
        assert.ok(defRegex.test(preloadCode), `${path.basename(file)} 呼叫了未定義的 smartOcrApi.${fnName}()`);
      }
    }
  });
}

// ============================================================================
// 5. 全域強制規範合規檢查
// ============================================================================
async function testGlobalCompliance() {
  const cat = '全域強制規範';

  await runTest(cat, 'overlay.html 與 settings.html 的 AI 模型選單嚴格符合規定清單', () => {
    const expectedModels = [
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-4.0-hydrogen',
      'gemini-4.0-flash-lite',
      'gemini-4.0-flash',
      'gemini-3.8-flash-lite',
      'gpt-4o-mini',
      'gpt-4.1-nano',
      '__custom__'
    ];

    const htmlFiles = [
      path.join(ROOT_DIR, 'src/renderer/overlay.html'),
      path.join(ROOT_DIR, 'src/renderer/settings.html')
    ];

    for (const file of htmlFiles) {
      const html = fs.readFileSync(file, 'utf8');
      const base = path.basename(file);

      // 驗證每個必備模型皆有對應 <option value="...">
      for (const m of expectedModels) {
        const optRegex = new RegExp(`<option[^>]*value=["']${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
        assert.ok(optRegex.test(html), `${base} 缺少必要模型選項: ${m}`);
      }

      // 驗證預設選中 gemini-2.5-flash-lite
      assert.ok(
        /<option[^>]*value=["']gemini-2\.5-flash-lite["'][^>]*\bselected\b|<option[^>]*\bselected\b[^>]*value=["']gemini-2\.5-flash-lite["']/i.test(html),
        `${base} 必須將 gemini-2.5-flash-lite 設為預設 selected`
      );

      // 嚴禁出現其他 3.x 非 Flash-Lite 模型
      const all3x = [...html.matchAll(/value=["'](gemini-3\.[^"']+)["']/gi)].map((m) => m[1]);
      for (const m3 of all3x) {
        assert.strictEqual(m3, 'gemini-3.8-flash-lite', `${base} 禁止出現非 Flash-Lite 的 3.x 模型: ${m3}`);
      }

      // 檢查模型下拉選單不含額外未允許之模型（只針對 model select 區塊）
      const modelSelectMatch = html.match(/<select[^>]*id=["'][^"']*model[^"']*["'][^>]*>([\s\S]*?)<\/select>/i);
      assert.ok(modelSelectMatch, `${base} 找不到 AI 模型 <select> 元素`);
      const actualModelValues = [...modelSelectMatch[1].matchAll(/<option[^>]*value=["']([^"']+)["']/gi)].map((m) => m[1]);
      for (const v of actualModelValues) {
        assert.ok(expectedModels.includes(v), `${base} 模型選單包含規定以外的冗餘模型: ${v}`);
      }
    }
  });

  await runTest(cat, '整個專案嚴禁出現簡體中文 (zh-CN / 簡體用語)', () => {
    const files = collectTextFiles(ROOT_DIR);
    // 以 Unicode 跳脫序列表示禁止字串，避免測試檔自身觸發誤判
    const forbiddenRegex = /zh[-_]CN|\u7b80\u4f53|\u8bbe\u7f6e|\u8bc6\u522b|\u622a\u56fe|\u5feb\u6377\u952e|\u8bed\u97f3|\u590d\u5236|\u6a21\u578b\u9009\u62e9|\u5173\u95ed|\u91cd\u8bd5/i;

    const violations = [];
    for (const file of files) {
      if (path.resolve(file) === path.resolve(__filename)) continue;
      const content = fs.readFileSync(file, 'utf8');
      const match = content.match(forbiddenRegex);
      if (match) {
        violations.push(`${path.relative(ROOT_DIR, file)} (發現: "${match[0]}")`);
      }
    }
    assert.strictEqual(violations.length, 0, `發現違規簡體字或 zh-CN：\n${violations.join('\n')}`);
  });

  await runTest(cat, 'overlay.js 與 settings.js 使用 Google 地端語音優先，且無外部機械 TTS 網址', () => {
    const files = [
      path.join(ROOT_DIR, 'src/renderer/overlay.js'),
      path.join(ROOT_DIR, 'src/renderer/settings.js')
    ];
    const bannedTtsUrl = /translate\.google\.[^/'"]+\/translate_tts|ttsmp3|voicerss|responsivevoice/i;

    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8');
      const base = path.basename(file);
      assert.ok(/speechSynthesis/.test(code), `${base} 必須使用 window.speechSynthesis`);
      assert.ok(/Google/i.test(code) && /localService/.test(code), `${base} 必須實作 Google + localService 地端語音優先排序`);
      assert.ok(!bannedTtsUrl.test(code), `${base} 嚴禁使用外部機械式 TTS 網址`);
    }
  });

  await runTest(cat, 'overlay.html 與 settings.html CSP 允許 data:/blob: 連線與音訊媒體播放', () => {
    const overlayHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/renderer/overlay.html'), 'utf8');
    const settingsHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/renderer/settings.html'), 'utf8');

    assert.ok(
      /connect-src[^;"]*data:[^;"]*blob:|connect-src[^;"]*blob:[^;"]*data:/i.test(overlayHtml),
      'overlay.html CSP 必須包含 connect-src \'self\' data: blob:，避免 decodeScreenshotRaw() 的 fetch(dataUrl) 被攔截'
    );

    for (const [name, html] of [['overlay.html', overlayHtml], ['settings.html', settingsHtml]]) {
      assert.ok(
        /media-src[^;"]*data:[^;"]*blob:|media-src[^;"]*blob:[^;"]*data:/i.test(html),
        `${name} CSP 必須包含 media-src 'self' data: blob:，以確保自然神經語音 <audio> 正常播放`
      );
    }
  });
}

// ============================================================================
// 6. 跨平台資產與設定檔案驗證
// ============================================================================
async function testAssetsAndBuildConfig() {
  const cat = '跨平台資產與設定';

  await runTest(cat, 'PNG / ICO / ICNS 圖示資產皆存在且 magic bytes 有效', () => {
    const pngFiles = [
      'assets/icon.png',
      'assets/tray-icon.png',
      'assets/tray-iconTemplate.png',
      'assets/tray-iconTemplate@2x.png'
    ];
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    for (const rel of pngFiles) {
      const full = path.join(ROOT_DIR, rel);
      assert.ok(fs.existsSync(full), `缺少圖示檔案: ${rel}`);
      const buf = fs.readFileSync(full);
      assert.ok(buf.length > 64, `${rel} 檔案過小`);
      assert.ok(buf.subarray(0, 8).equals(pngMagic), `${rel} PNG magic bytes 無效`);
    }

    // 驗證主圖示 icon.png 寬高 >= 256
    const mainIconBuf = fs.readFileSync(path.join(ROOT_DIR, 'assets/icon.png'));
    const width = mainIconBuf.readUInt32BE(16);
    const height = mainIconBuf.readUInt32BE(20);
    assert.ok(width >= 256 && height >= 256, `assets/icon.png 尺寸應 >= 256x256，實際: ${width}x${height}`);

    // 驗證 Windows ICO
    const icoPath = path.join(ROOT_DIR, 'assets/icon.ico');
    assert.ok(fs.existsSync(icoPath), '缺少 assets/icon.ico');
    const icoBuf = fs.readFileSync(icoPath);
    assert.strictEqual(icoBuf.readUInt16LE(0), 0, 'ICO reserved 必須為 0');
    assert.strictEqual(icoBuf.readUInt16LE(2), 1, 'ICO type 必須為 1');
    const icoCount = icoBuf.readUInt16LE(4);
    assert.ok(icoCount >= 4, `ICO 應包含多尺寸圖示 (>=4)，實際: ${icoCount}`);

    // 驗證 macOS ICNS
    const icnsPath = path.join(ROOT_DIR, 'assets/icon.icns');
    assert.ok(fs.existsSync(icnsPath), '缺少 assets/icon.icns');
    const icnsBuf = fs.readFileSync(icnsPath);
    assert.strictEqual(icnsBuf.subarray(0, 4).toString('ascii'), 'icns', 'ICNS magic bytes 必須為 icns');
    assert.strictEqual(icnsBuf.readUInt32BE(4), icnsBuf.length, 'ICNS 標頭長度與實際檔案大小不符');
  });

  await runTest(cat, 'electron-builder.yml、macOS entitlements 與 GitHub Actions 設定完整有效', () => {
    const builderYml = fs.readFileSync(path.join(ROOT_DIR, 'electron-builder.yml'), 'utf8');
    assert.ok(builderYml.includes('com.smartscreenocr.desktop'), 'electron-builder.yml 缺少 appId');
    assert.ok(builderYml.includes('Smart Screen OCR'), 'electron-builder.yml 缺少 productName');
    assert.ok(builderYml.includes('nsis') && builderYml.includes('portable'), 'electron-builder.yml 缺少 Windows nsis/portable 目標');
    assert.ok(builderYml.includes('dmg') && builderYml.includes('arm64') && builderYml.includes('x64'), 'electron-builder.yml 缺少 macOS dmg arm64/x64 目標');
    assert.ok(builderYml.includes('NSScreenCaptureUsageDescription'), 'electron-builder.yml 缺少 macOS 螢幕錄製權限說明');
    assert.ok(builderYml.includes('entitlements.mac.plist'), 'electron-builder.yml 缺少 entitlements 引用');

    const plist = fs.readFileSync(path.join(ROOT_DIR, 'build/entitlements.mac.plist'), 'utf8');
    assert.ok(plist.includes('<?xml') && plist.includes('<plist') && plist.includes('</plist>'), 'entitlements.mac.plist XML 結構不完整');

    const workflow = fs.readFileSync(path.join(ROOT_DIR, '.github/workflows/build-desktop.yml'), 'utf8');
    assert.ok(workflow.includes('windows-latest') && workflow.includes('macos-latest'), 'GitHub Actions 必須同時建置 windows-latest 與 macos-latest');

    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'start-win.bat')), '缺少 start-win.bat');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'start-mac.command')), '缺少 start-mac.command');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'README.md')), '缺少 README.md');
  });
}

// ============================================================================
// 7. 原始 Chrome 擴充功能未受影響驗證
// ============================================================================
async function testOriginalExtensionIntact() {
  const cat = '原始專案保護';

  await runTest(cat, 'smart-screen-ocr-gemini/ 原始檔案 SHA-256 100% 未遭修改', () => {
    // 若於獨立 CI 環境（僅檢出 smart-screen-ocr-desktop）執行，允許略過外層目錄檢查
    if (!fs.existsSync(ORIGINAL_EXT_DIR)) {
      if (process.env.CI) {
        console.log('     ℹ️ CI 獨立環境未包含外層 smart-screen-ocr-gemini/ 目錄，略過比對');
        return;
      }
      assert.fail(`找不到原始擴充功能目錄: ${ORIGINAL_EXT_DIR}`);
    }

    const expectedHashes = {
      'background.js': 'F71B0153E6857E908FE04A0F5FADC1AE46C782F4E8A4BBA72EE7C8E501EA3084',
      'content.js': '53EC13CD8FB04E3AF66FF13B37A2FBCD6C194B57D263561C9FEBDF6B35331911',
      'manifest.json': 'AA2D60DAB5C6359E9016FE8DC7A05ACEE6697E464871F88994D27A39E7F43360',
      'options.html': '228F6042EAAE8A1D072CE4E97F98F9195BA08EEB942F720D6A2C3E73C6B2E6B3',
      'options.js': '4289DEDC9010000C76655BFC6DA97679F065474B8F73D7C235FD9FD174410591',
      'README.md': '709B3FB74494E59B3B1B97F498FD14C9973A766AF2D27D8EF6F96B31E1B9AC58',
      'icons/icon128.png': '5B6ADE9E8FB6072FED31D81114C0F5EC28E5C82A0C0064090852E482338B5C8B',
      'icons/icon16.png': '274D22EA96BB77832E606D2B0272BBEE5BBE061DC2B2535E2A77143A569745C6',
      'icons/icon48.png': '2524AE8C5427F06E7B38ECCA30BF84E244C728DE99E0AC76D824EB51CE245210'
    };

    for (const [rel, expected] of Object.entries(expectedHashes)) {
      const full = path.join(ORIGINAL_EXT_DIR, rel);
      assert.ok(fs.existsSync(full), `原始檔案遺失: ${rel}`);
      const actual = sha256File(full);
      assert.strictEqual(actual, expected, `原始擴充功能檔案遭修改: ${rel}`);
    }
  });
}

// ============================================================================
// 8. 高品質自然語音引擎測試 (ttsService.js: Edge Neural 實機 + Google Gemini TTS)
// ============================================================================
async function testTtsService() {
  const cat = '自然語音引擎';

  /**
   * 驗證 MP3 二進位資料是否具有有效 MP3 檔頭（ID3 或 MPEG Frame Sync）
   * @param {Buffer} buf 解碼後的音訊位元組
   */
  function isValidMp3Buffer(buf) {
    if (!Buffer.isBuffer(buf) || buf.length <= 1000) return false;
    // ID3v2 標頭
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
    // 前 512 bytes 內尋找 MPEG audio frame sync (0xFF + 高 3 bits 為 111)
    const scanLen = Math.min(buf.length - 1, 512);
    for (let i = 0; i < scanLen; i++) {
      if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) return true;
    }
    return false;
  }

  await runTest(cat, 'TTS 選項清單 (getTtsOptions) 涵蓋 3 種引擎且嚴格排除簡體中文語音', () => {
    const ttsPath = path.join(ROOT_DIR, 'src/main/ttsService.js');
    const ttsCode = fs.readFileSync(ttsPath, 'utf8');
    assert.ok(
      !/translate\.google\.[^/'"]+\/translate_tts/i.test(ttsCode),
      'ttsService.js 嚴禁使用舊式 Google Translate 非官方機械 TTS 網址'
    );

    const tts = require(ttsPath);
    const opts = tts.getTtsOptions();
    assert.ok(opts && typeof opts === 'object', 'getTtsOptions 必須回傳物件');

    const engineIds = (opts.engines || []).map((e) => (typeof e === 'string' ? e : e.id));
    for (const req of ['edge-neural', 'google-gemini', 'system-local']) {
      assert.ok(engineIds.includes(req), `getTtsOptions.engines 缺少引擎: ${req}`);
    }

    const edgeMap = opts.edgeVoicesByLang || {};
    const serializedEdge = JSON.stringify(edgeMap);
    assert.ok(!/zh[-_]CN/i.test(serializedEdge), 'edgeVoicesByLang 嚴禁包含簡體中文語系');
    assert.ok(serializedEdge.includes('zh-TW-HsiaoChenNeural'), 'edgeVoicesByLang 應包含台灣女聲 zh-TW-HsiaoChenNeural');
    assert.ok(serializedEdge.includes('en-US-JennyNeural'), 'edgeVoicesByLang 應包含英文自然聲線 en-US-JennyNeural');

    const geminiVoices = (opts.geminiVoices || []).map((v) => (typeof v === 'string' ? v : v.id || v.name));
    for (const v of ['Kore', 'Aoede', 'Puck', 'Charon', 'Fenrir', 'Leda']) {
      assert.ok(geminiVoices.includes(v), `geminiVoices 缺少預建聲線: ${v}`);
    }
  });

  await runTest(cat, 'Edge 自然神經語音實機合成（繁體中文 + 英文皆回傳 >1KB 真實 MP3）', async () => {
    const tts = require(path.join(ROOT_DIR, 'src/main/ttsService.js'));
    const isCiEnv = Boolean(process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0');

    // 1. 實機合成繁體中文
    const zhRes = await tts.synthesizeSpeech(
      { text: '你好，這是自然語音測試', lang: 'zh-TW', rate: 1.0, engine: 'edge-neural' },
      { ttsEngine: 'edge-neural' }
    );
    if (!zhRes.ok && isCiEnv) {
      // GitHub Actions 等雲端機房 IP 偶爾會遭 Microsoft Edge TTS 封鎖 (403/逾時)，於 CI 環境驗證備援標記後安全略過
      assert.strictEqual(zhRes.fallbackToLocal, true, 'CI 連線失敗時仍應正確回傳 fallbackToLocal: true');
      console.log(`     ⚠️ 偵測到 CI 雲端環境，Edge 繁中語音外網連線受限（${zhRes.error || '連線失敗'}），已確認備援機制並略過此筆外網實測`);
      return;
    }
    assert.strictEqual(zhRes.ok, true, `Edge 繁中實機合成失敗: ${zhRes.error || '未知錯誤'}`);
    assert.ok(
      typeof zhRes.audioDataUrl === 'string' && zhRes.audioDataUrl.startsWith('data:audio/mpeg;base64,'),
      'Edge 繁中回傳必須為 data:audio/mpeg;base64,...'
    );
    const zhBuf = Buffer.from(zhRes.audioDataUrl.slice('data:audio/mpeg;base64,'.length), 'base64');
    assert.ok(zhBuf.length > 1000, `Edge 繁中音訊資料過小: ${zhBuf.length} bytes`);
    assert.ok(isValidMp3Buffer(zhBuf), 'Edge 繁中解碼後並非有效 MP3 格式');

    // 2. 實機合成英文
    const enRes = await tts.synthesizeSpeech(
      { text: 'Hello, this is a natural neural voice test.', lang: 'en-US', rate: 1.0, engine: 'edge-neural' },
      { ttsEngine: 'edge-neural' }
    );
    if (!enRes.ok && isCiEnv) {
      assert.strictEqual(enRes.fallbackToLocal, true, 'CI 連線失敗時仍應正確回傳 fallbackToLocal: true');
      console.log(`     ⚠️ 偵測到 CI 雲端環境，Edge 英文語音外網連線受限（${enRes.error || '連線失敗'}），已確認備援機制並略過此筆外網實測`);
      return;
    }
    assert.strictEqual(enRes.ok, true, `Edge 英文實機合成失敗: ${enRes.error || '未知錯誤'}`);
    assert.ok(
      typeof enRes.audioDataUrl === 'string' && enRes.audioDataUrl.startsWith('data:audio/mpeg;base64,'),
      'Edge 英文回傳必須為 data:audio/mpeg;base64,...'
    );
    const enBuf = Buffer.from(enRes.audioDataUrl.slice('data:audio/mpeg;base64,'.length), 'base64');
    assert.ok(enBuf.length > 1000, `Edge 英文音訊資料過小: ${enBuf.length} bytes`);
    assert.ok(isValidMp3Buffer(enBuf), 'Edge 英文解碼後並非有效 MP3 格式');
  });

  await runTest(cat, 'Google Gemini 官方 TTS 單元測試（請求格式、PCM 轉 44-byte WAV 與缺 Key 備援）', async () => {
    const tts = require(path.join(ROOT_DIR, 'src/main/ttsService.js'));

    // 準備模擬 24kHz 16-bit mono PCM 資料（2048 bytes）
    const fakePcm = Buffer.alloc(2048, 0x12);
    let capturedUrl = '';
    let capturedBody = null;

    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/L16;codec=pcm;rate=24000',
                      data: fakePcm.toString('base64')
                    }
                  }
                ]
              }
            }
          ]
        })
      };
    };

    const res = await tts.synthesizeSpeech(
      { text: '測試 Gemini 自然語音', lang: 'zh-TW', engine: 'google-gemini', voiceName: 'Aoede' },
      { geminiApiKey: 'AIza-TTS-Test', ttsEngine: 'google-gemini', geminiTtsVoice: 'Kore' },
      { fetchImpl: mockFetch }
    );

    assert.strictEqual(res.ok, true, `Gemini TTS 單元測試失敗: ${res.error}`);
    assert.ok(capturedUrl.includes('gemini-2.5-flash-preview-tts:generateContent'), `端點錯誤: ${capturedUrl}`);
    assert.ok(
      Array.isArray(capturedBody?.generationConfig?.responseModalities) &&
        capturedBody.generationConfig.responseModalities.includes('AUDIO'),
      '請求必須設定 generationConfig.responseModalities 包含 AUDIO'
    );
    assert.strictEqual(
      capturedBody?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName,
      'Aoede',
      '請求必須帶入正確的 prebuiltVoiceConfig.voiceName'
    );

    // 驗證轉出的 WAV 44-byte 標準 RIFF 檔頭
    assert.ok(res.audioDataUrl.startsWith('data:audio/wav;base64,'), 'Gemini TTS 必須轉為 data:audio/wav;base64,...');
    const wavBuf = Buffer.from(res.audioDataUrl.slice('data:audio/wav;base64,'.length), 'base64');
    assert.strictEqual(wavBuf.length, 44 + fakePcm.length, 'WAV 總長度必須等於 44-byte 標頭 + PCM 資料長度');
    assert.strictEqual(wavBuf.subarray(0, 4).toString('ascii'), 'RIFF', 'WAV 標頭缺少 RIFF');
    assert.strictEqual(wavBuf.subarray(8, 12).toString('ascii'), 'WAVE', 'WAV 標頭缺少 WAVE');
    assert.strictEqual(wavBuf.subarray(12, 16).toString('ascii'), 'fmt ', 'WAV 標頭缺少 fmt ');
    assert.strictEqual(wavBuf.readUInt16LE(20), 1, 'WAV 音訊格式必須為 PCM (1)');
    assert.strictEqual(wavBuf.readUInt16LE(22), 1, 'WAV 聲道數必須為單聲道 (1)');
    assert.strictEqual(wavBuf.readUInt32LE(24), 24000, 'WAV 取樣率必須為 24000Hz');
    assert.strictEqual(wavBuf.readUInt16LE(34), 16, 'WAV 位元深度必須為 16-bit');
    assert.strictEqual(wavBuf.subarray(36, 40).toString('ascii'), 'data', 'WAV 標頭缺少 data chunk');
    assert.strictEqual(wavBuf.readUInt32LE(40), fakePcm.length, 'WAV data chunk 長度必須等於 PCM 長度');

    // 驗證缺少 Gemini API Key 時回傳錯誤與 fallbackToLocal: true
    const noKeyRes = await tts.synthesizeSpeech(
      { text: '缺金鑰測試', lang: 'zh-TW', engine: 'google-gemini' },
      { geminiApiKey: '', ttsEngine: 'google-gemini' },
      { fetchImpl: async () => { throw new Error('缺 Key 不應呼叫 fetch'); } }
    );
    assert.strictEqual(noKeyRes.ok, false, '缺少 Gemini API Key 應回傳 ok: false');
    assert.strictEqual(noKeyRes.fallbackToLocal, true, '缺少 Gemini API Key 應回傳 fallbackToLocal: true');
  });
}

// ============================================================================
// 9. 行動免安裝模式 (portable-data/) 與擴充設定驗證
// ============================================================================
async function testPortableMode() {
  const cat = '行動免安裝模式';

  await runTest(cat, 'DEFAULT_SETTINGS 包含新版語音引擎與連動配色主題預設欄位', () => {
    const mod = require(path.join(ROOT_DIR, 'src/main/settingsStore.js'));
    const def = mod.DEFAULT_SETTINGS;
    assert.strictEqual(def.ttsEngine, 'edge-neural', '預設語音引擎必須為 edge-neural');
    assert.strictEqual(def.geminiTtsVoice, 'Kore', '預設 Gemini TTS 聲線必須為 Kore');
    assert.strictEqual(def.themePreset, 'midnight', '預設主題必須為 midnight');
    assert.strictEqual(def.edgeVoiceMap['zh-TW'], 'zh-TW-HsiaoChenNeural');
    assert.strictEqual(def.edgeVoiceMap['en-US'], 'en-US-JennyNeural');
    assert.ok(!Object.keys(def.edgeVoiceMap).some((k) => /zh[-_]CN/i.test(k)), 'edgeVoiceMap 嚴禁包含簡體中文語系');
    assert.strictEqual(def.customTheme.bgPrimary, '#0f172a');
    assert.strictEqual(def.customTheme.accentColor, '#38bdf8');
  });

  await runTest(cat, 'SMART_OCR_PORTABLE_DIR 與 PORTABLE_EXECUTABLE_DIR 正確導向隨身設定檔', () => {
    const mod = require(path.join(ROOT_DIR, 'src/main/settingsStore.js'));
    assert.strictEqual(typeof mod.resolvePortableDataDir, 'function', 'settingsStore.js 必須匯出 resolvePortableDataDir');

    const tmp1 = createTempDir('smart-ocr-p1-');
    const tmp2 = createTempDir('smart-ocr-p2-');
    try {
      // 1. SMART_OCR_PORTABLE_DIR 優先
      const dir1 = mod.resolvePortableDataDir({ env: { SMART_OCR_PORTABLE_DIR: tmp1 }, execPath: 'C:\\fake\\app.exe', platform: 'win32' });
      assert.strictEqual(path.resolve(dir1), path.resolve(tmp1));

      // 2. PORTABLE_EXECUTABLE_DIR (Windows electron-builder portable)
      const dir2 = mod.resolvePortableDataDir({ env: { PORTABLE_EXECUTABLE_DIR: tmp2 }, execPath: 'C:\\fake\\app.exe', platform: 'win32' });
      assert.strictEqual(path.resolve(dir2), path.resolve(path.join(tmp2, 'portable-data')));

      // 實際以環境變數寫入 settings.json 驗證端到端運作
      const prevEnv = process.env.SMART_OCR_PORTABLE_DIR;
      process.env.SMART_OCR_PORTABLE_DIR = tmp1;
      try {
        const store = mod.createSettingsStore();
        assert.strictEqual(path.resolve(store.getFilePath()), path.resolve(path.join(tmp1, 'settings.json')));
        store.save({ themePreset: 'aurora-emerald' });
        assert.ok(fs.existsSync(path.join(tmp1, 'settings.json')), '設定檔應寫入 SMART_OCR_PORTABLE_DIR/settings.json');
      } finally {
        if (prevEnv === undefined) delete process.env.SMART_OCR_PORTABLE_DIR;
        else process.env.SMART_OCR_PORTABLE_DIR = prevEnv;
      }
    } finally {
      fs.rmSync(tmp1, { recursive: true, force: true });
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });

  await runTest(cat, '執行檔旁存在 portable-data/ 時自動啟用行動模式（涵蓋 Windows 與 macOS .app 結構）', () => {
    const mod = require(path.join(ROOT_DIR, 'src/main/settingsStore.js'));
    const tmpWin = createTempDir('smart-ocr-win-portable-');
    const tmpMac = createTempDir('smart-ocr-mac-portable-');
    try {
      // 模擬 Windows 執行檔旁存在 portable-data/
      const winPortableDir = path.join(tmpWin, 'portable-data');
      fs.mkdirSync(winPortableDir, { recursive: true });
      const winExec = path.join(tmpWin, 'Smart Screen OCR.exe');
      const detectedWin = mod.resolvePortableDataDir({ env: {}, execPath: winExec, platform: 'win32' });
      assert.strictEqual(path.resolve(detectedWin), path.resolve(winPortableDir), 'Windows 應偵測到執行檔旁 portable-data/');

      // 模擬 macOS Smart Screen OCR.app/Contents/MacOS/Smart Screen OCR 結構旁存在 portable-data/
      const macPortableDir = path.join(tmpMac, 'portable-data');
      const macBinDir = path.join(tmpMac, 'Smart Screen OCR.app', 'Contents', 'MacOS');
      fs.mkdirSync(macPortableDir, { recursive: true });
      fs.mkdirSync(macBinDir, { recursive: true });
      const macExec = path.join(macBinDir, 'Smart Screen OCR');
      const detectedMac = mod.resolvePortableDataDir({ env: {}, execPath: macExec, platform: 'darwin' });
      assert.strictEqual(path.resolve(detectedMac), path.resolve(macPortableDir), 'macOS 應往上三層至 .app 所在目錄偵測 portable-data/');
    } finally {
      fs.rmSync(tmpWin, { recursive: true, force: true });
      fs.rmSync(tmpMac, { recursive: true, force: true });
    }
  });
}

// ============================================================================
// 10. 全域連動配色主題系統測試 (themeHelper.js + HTML/CSS/JS 整合)
// ============================================================================
async function testThemeSystem() {
  const cat = '連動配色主題';

  /**
   * 載入 themeHelper.js（支援 CommonJS module.exports 與瀏覽器全域 window 物件）
   */
  function loadThemeHelper() {
    const filePath = path.join(ROOT_DIR, 'src/renderer/themeHelper.js');
    assert.ok(fs.existsSync(filePath), '缺少 src/renderer/themeHelper.js');
    const code = fs.readFileSync(filePath, 'utf8');
    const sandbox = { window: {}, globalThis: {}, module: { exports: {} }, exports: {} };
    sandbox.globalThis = sandbox.window;
    vm.runInNewContext(code, sandbox, { filename: 'themeHelper.js' });
    const exported =
      (sandbox.module.exports && Object.keys(sandbox.module.exports).length > 0 && sandbox.module.exports) ||
      sandbox.window.SmartOcrTheme ||
      sandbox.window;
    return exported;
  }

  await runTest(cat, 'themeHelper.js 6 組預設主題與 custom 自訂配色皆能輸出並套用完整 CSS 變數', () => {
    const helper = loadThemeHelper();
    assert.ok(helper.THEME_PRESETS, 'themeHelper.js 必須提供 THEME_PRESETS');
    assert.strictEqual(typeof helper.resolveThemeTokens, 'function', 'themeHelper.js 必須提供 resolveThemeTokens');
    assert.strictEqual(typeof helper.applyThemeToDocument, 'function', 'themeHelper.js 必須提供 applyThemeToDocument');

    const presetIds = ['midnight', 'aurora-emerald', 'violet-nebula', 'amber-obsidian', 'daylight-clean', 'paper-warm'];
    const presetsObj = Array.isArray(helper.THEME_PRESETS)
      ? Object.fromEntries(helper.THEME_PRESETS.map((p) => [p.id, p]))
      : helper.THEME_PRESETS;

    for (const id of presetIds) {
      assert.ok(presetsObj[id], `THEME_PRESETS 缺少預設主題: ${id}`);
      const tokens = helper.resolveThemeTokens({ themePreset: id });
      const cssVarsObj = (tokens && tokens.cssVars) || tokens || {};
      const keys = Object.keys(cssVarsObj).filter((k) => k.startsWith('--'));
      assert.ok(keys.length >= 20, `主題 ${id} 產出的 CSS 變數數量過少: ${keys.length}`);
    }

    // 確認淺色主題 (daylight-clean / paper-warm) 正確識別為 isLight: true，深色主題 (midnight) 為 false
    assert.strictEqual(helper.resolveThemeTokens({ themePreset: 'midnight' }).isLight, false, 'midnight 應為深色主題');
    assert.strictEqual(helper.resolveThemeTokens({ themePreset: 'daylight-clean' }).isLight, true, 'daylight-clean 應為淺色主題');
    assert.strictEqual(helper.resolveThemeTokens({ themePreset: 'paper-warm' }).isLight, true, 'paper-warm 應為淺色主題');

    // 確認預設 midnight 維持既有夜空藍主色票
    const midnightSerialized = JSON.stringify(presetsObj.midnight).toLowerCase();
    assert.ok(midnightSerialized.includes('#0f172a') && midnightSerialized.includes('#38bdf8'), 'midnight 預設配色必須維持原版 #0f172a / #38bdf8');

    // 測試深色與淺色自訂配色皆可計算並寫入 mock rootEl.style
    const appliedVars = {};
    const mockRoot = {
      dataset: {},
      style: {
        setProperty(k, v) {
          appliedVars[k] = v;
        }
      }
    };

    helper.applyThemeToDocument(
      {
        themePreset: 'custom',
        customTheme: {
          bgPrimary: '#ffffff',
          bgSurface: '#f8fafc',
          accentColor: '#0284c7',
          accentSecondary: '#6366f1',
          textPrimary: '#0f172a'
        }
      },
      mockRoot
    );
    assert.ok(Object.keys(appliedVars).length >= 8, 'applyThemeToDocument 應寫入完整 CSS 自訂屬性變數');
    assert.ok(
      Object.keys(appliedVars).every((k) => k.startsWith('--')),
      'applyThemeToDocument 寫入的屬性名稱應為合法 CSS 變數 (--*)'
    );
  });

  await runTest(cat, 'settings.html / overlay.html / overlay.css / JS 完整串接連動主題變數', () => {
    const settingsHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/renderer/settings.html'), 'utf8');
    const overlayHtml = fs.readFileSync(path.join(ROOT_DIR, 'src/renderer/overlay.html'), 'utf8');
    const overlayCss = fs.readFileSync(path.join(ROOT_DIR, 'src/renderer/overlay.css'), 'utf8');
    const settingsJs = fs.readFileSync(path.join(ROOT_DIR, 'src/renderer/settings.js'), 'utf8');
    const overlayJs = fs.readFileSync(path.join(ROOT_DIR, 'src/renderer/overlay.js'), 'utf8');

    assert.ok(settingsHtml.includes('themeHelper.js'), 'settings.html 必須載入 themeHelper.js');
    assert.ok(overlayHtml.includes('themeHelper.js'), 'overlay.html 必須載入 themeHelper.js');
    assert.ok(/var\(--[a-z0-9-]+/i.test(overlayCss), 'overlay.css 必須使用主題 CSS 變數');
    assert.ok(settingsJs.includes('applyThemeToDocument'), 'settings.js 必須呼叫 applyThemeToDocument');
    assert.ok(overlayJs.includes('applyThemeToDocument'), 'overlay.js 必須呼叫 applyThemeToDocument');
  });
}

// ============================================================================
// 11. macOS 行動免安裝打包腳本與 CI 工作流檢查
// ============================================================================
async function testMacPortableBuildConfig() {
  const cat = 'macOS 行動免安裝';

  await runTest(cat, 'scripts/package-mac-portable.sh 為純 LF 換行且涵蓋完整行動免安裝封裝邏輯', () => {
    const scriptPath = path.join(ROOT_DIR, 'scripts/package-mac-portable.sh');
    assert.ok(fs.existsSync(scriptPath), '缺少 scripts/package-mac-portable.sh');
    const raw = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(!raw.includes('\r\n'), 'scripts/package-mac-portable.sh 必須為純 LF 換行（不可含 CRLF）');
    assert.ok(raw.startsWith('#!/'), 'scripts/package-mac-portable.sh 必須有 shebang');
    assert.ok(raw.includes('portable-data'), '腳本必須建立 portable-data 資料夾');
    assert.ok(raw.includes('xattr -cr'), '腳本必須產出含 xattr -cr 的首次啟動解鎖指令');
    assert.ok(raw.includes('ditto'), '腳本必須使用 ditto 保留 macOS .app 權限與符號連結');
    assert.ok(raw.includes('首次開啟免安裝版.command'), '腳本必須產出 首次開啟免安裝版.command');
    assert.ok(raw.includes('行動免安裝使用說明.txt'), '腳本必須產出 行動免安裝使用說明.txt');
    assert.ok(raw.includes('Smart-Screen-OCR-macOS-'), '腳本必須輸出 Smart-Screen-OCR-macOS-<arch>-Portable.zip');
  });

  await runTest(cat, 'package.json、GitHub Actions 與 README.md 完整整合 macOS 行動免安裝與新功能說明', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts && pkg.scripts['build:mac-portable'], 'package.json 缺少 build:mac-portable script');

    const workflow = fs.readFileSync(path.join(ROOT_DIR, '.github/workflows/build-desktop.yml'), 'utf8');
    assert.ok(workflow.includes('package-mac-portable.sh'), 'GitHub Actions 必須執行 scripts/package-mac-portable.sh');
    assert.ok(workflow.includes('Portable.zip'), 'GitHub Actions 必須上傳 macOS Portable.zip Artifact');

    const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
    assert.ok(readme.includes('portable-data'), 'README.md 必須說明 portable-data 隨身行動模式');
    assert.ok(/Edge.*神經|自然神經語音/i.test(readme), 'README.md 必須說明 Edge / Gemini 自然神經語音');
    assert.ok(/配色|主題/.test(readme), 'README.md 必須說明連動配色主題功能');
  });
}

// ============================================================================
// 主執行進入點
// ============================================================================
async function main() {
  console.log('\n🧪 Smart Screen OCR Desktop 自動化測試套件啟動...\n');

  await testSettingsStore();
  await testShortcutHelper();
  await testAiService();
  await testIpcContracts();
  await testGlobalCompliance();
  await testAssetsAndBuildConfig();
  await testOriginalExtensionIntact();
  await testTtsService();
  await testPortableMode();
  await testThemeSystem();
  await testMacPortableBuildConfig();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n============================================================');
  console.log(`📊 測試總結：共 ${results.length} 項｜✅ 通過 ${passed} 項｜❌ 失敗 ${failed} 項`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('測試執行器發生未預期錯誤:', err);
  process.exit(1);
});
