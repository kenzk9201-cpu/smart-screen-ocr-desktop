# Smart Screen OCR 桌面版（Windows & macOS）

**Smart Screen OCR** 是一款跨平台（支援 **Windows** 與 **macOS**，並提供**雙平台行動免安裝版**）的智慧螢幕截圖、AI 文字辨識 (OCR) 與多輪對話助手桌面應用程式。承襲三星智慧選取風格的流暢框選體驗，讓您在系統中任何視窗、影片、PDF 或簡報上，按下全域快捷鍵即可瞬間凍結畫面、精準擷取文字，並立即進行自然神經語音朗讀或 AI 追問翻譯。

---

## ✨ 核心功能特色

- **跨視窗與多螢幕瞬間凍結截圖**：自動偵測滑鼠所在螢幕，按下全域快捷鍵（預設 `Alt+Shift+S`）即可凍結目前畫面進行自由框選，並精準支援 High-DPI / Retina 無色偏縮放對齊。
- **三星智慧選取風格互動介面**：提供圓角發光掃描外框、頂部膠囊狀態列、懸浮 OCR 辨識結果卡片（複製文字、語音朗讀、查詢 AI、翻譯、另存高畫質圖片、重試）與可拖曳的 AI 多輪追問對話視窗。
- **多元 AI 模型支援與快速辨識**：
  - ⭐ **預設推薦（Gemini 2.5 免費模型）**：`gemini-2.5-flash-lite`（預設選中）、`gemini-2.5-flash`（內建高速模式降低延遲）。
  - 🚀 **Gemini 4.0 系列**：`gemini-4.0-hydrogen`、`gemini-4.0-flash-lite`、`gemini-4.0-flash`。
  - ⚡ **Gemini 3.x 輕量系列**：`gemini-3.8-flash-lite`。
  - 🌐 **OpenAI 輕量 / 相容 API 系列**：`gpt-4o-mini`、`gpt-4.1-nano`，並支援自訂 `OpenAI Base URL`。
  - ✏️ **自訂模型 ID**：可隨時手動輸入最新模型代號並指定 API 類型（自動偵測 / Gemini / OpenAI）。
- **三引擎高品質自然語音朗讀（告別舊式機械音）**：
  - 🌟 **Edge 自然神經語音 (`edge-neural`・預設免金鑰)**：採用與 Microsoft Edge「大聲朗讀」同等級的神經網路自然聲線，免費免設定 API Key，內建台灣繁體中文（曉臻、雲哲、曉雨）與英、日、韓、西、法、德等多國自然聲線。
  - ✨ **Google Gemini 官方自然語音 (`google-gemini`・需 Gemini API Key)**：呼叫官方 Gemini Audio TTS (`gemini-2.5-flash-preview-tts`)，提供 `Kore`、`Aoede`、`Puck`、`Charon`、`Fenrir`、`Leda` 等高擬真語音聲線。
  - 🖥️ **系統地端語音 (`system-local`・離線可用)**：採用內建語音合成 (`window.speechSynthesis`)，自動優先挑選 **Google 地端自然語音**（絕不使用雲端機械 TTS）；當網路離線或未設定金鑰時，亦會自動平滑備援至系統地端語音。
  - 支援語速調整（0.7x ～ 1.5x）與設定頁即時試聽。
- **全介面連動配色主題與自訂色盤**：
  - 內建 6 組精選主題配色（**深夜藍海 Midnight**、**極光翡翠 Aurora Emerald**、**紫羅蘭星雲 Violet Nebula**、**琥珀黑曜 Amber Obsidian**、**潔淨日光 Daylight Clean**、**暖白紙感 Paper Warm**）與 **自訂色盤 (`custom`)**（可自由調整主背景、卡片底色、主強調色、次強調色與文字色）。
  - 於設定視窗切換主題或微調色盤時，會即時連動套用至**設定頁、全螢幕凍結截圖覆蓋層、懸浮 OCR 結果卡片與 AI 查找翻譯對話面板**，保持一致且舒適的視覺體驗。
- **常駐系統列與行動免安裝模式 (`portable-data/`)**：
  - 支援 Windows 系統匣彩色圖示與 macOS 頂部選單列單色 Template 圖示（自動適應深色／淺色選單列）及開機自動啟動。
  - Windows 與 macOS 皆支援**隨身行動免安裝模式**，將設定直接保存在程式旁的 `portable-data/settings.json`，不留痕跡且可隨身碟跨機使用。

---

## 🎙️ 自然語音引擎切換說明

在應用程式的 **「設定視窗 → 語音朗讀設定」** 中，可依需求隨時切換三種語音引擎：

| 引擎模式 | 特色與適用情境 | 是否需要金鑰 | 聲線選項 |
| --- | --- | --- | --- |
| **🌟 Edge 自然神經語音 (`edge-neural`)** | **預設推薦**。與 Microsoft Edge 大聲朗讀同款自然人聲，徹底解決 Windows 系統舊式機械音問題 | 否（免費免金鑰） | 繁中：曉臻 / 雲哲 / 曉雨；英文：Jenny / Guy / Aria 等多語自然聲線 |
| **✨ Google Gemini 自然語音 (`google-gemini`)** | 官方 Gemini 2.5 Audio TTS 高擬真情感語音 | 是（使用已填寫的 Gemini API Key） | `Kore` / `Aoede` / `Puck` / `Charon` / `Fenrir` / `Leda` |
| **🖥️ 系統地端語音 (`system-local`)** | 完全離線可用，優先選用系統內建 Google 地端自然語音 (`localService: true`) | 否（離線免金鑰） | 系統內建語音清單（自動排序） |

---

## 🎨 全介面連動配色主題說明

在 **「設定視窗 → 外觀主題與配色」** 中：
1. 點選任一預設主題卡片即可即時預覽並切換整套配色（包含深色護眼與淺色明亮風格）。
2. 選擇 **「自訂配色 (`custom`)」** 可透過五組色票選擇器自由定義主背景色、面板底色、強調主色、強調次色與主要文字色。
3. 儲存後會立即同步至所有開啟中的視窗——包含 **設定儀表板、凍結截圖覆蓋層框選光暈、OCR 辨識結果浮動卡片、以及 AI 查找與翻譯對話面板**。

---

## 🎒 macOS 行動免安裝版 (Portable Edition) 專節

想把 **Smart Screen OCR** 放進隨身碟、外接 SSD 或雲端同步資料夾，無需安裝到「應用程式 (Applications)」即可在多台 Mac 直接使用嗎？本專案提供專屬的 **macOS 行動免安裝版**：

- **Apple Silicon (M1 / M2 / M3 / M4)**：`Smart-Screen-OCR-macOS-arm64-Portable.zip`
- **Intel Mac (`x64`)**：`Smart-Screen-OCR-macOS-x64-Portable.zip`

### 解壓後的隨身資料夾結構
```text
Smart-Screen-OCR-macOS-arm64-Portable/
├── Smart Screen OCR.app        # 完整桌面應用程式（免移至「應用程式」即可直接執行）
├── portable-data/              # 隨身設定資料夾（自動保存 settings.json，不寫入宿主 Mac）
├── 首次開啟免安裝版.command    # 一鍵解除 Gatekeeper 下載隔離並啟動程式
└── 行動免安裝使用說明.txt      # 繁體中文快速指南
```

### 行動免安裝版三大優勢與使用步驟
1. **設定隨身帶著走 (`portable-data/`)**：
   - 只要 `Smart Screen OCR.app` 同層目錄存在 `portable-data/` 資料夾，主程式啟動時會自動偵測並進入**行動免安裝模式**（設定頁狀態列將顯示「🎒 行動免安裝模式」徽章）。
   - 您的 API Key、全域快捷鍵、自訂配色主題與語音偏好皆保存在 `portable-data/settings.json`，**絕不寫入宿主 Mac 的 `~/Library/Application Support/`**。
2. **一鍵解除 Gatekeeper 隔離阻擋**：
   - 解壓縮後，首次使用只需雙擊資料夾內的 **`首次開啟免安裝版.command`**，腳本會自動對同目錄的 `Smart Screen OCR.app` 執行 `xattr -cr` 解除 macOS 下載隔離標記並立即啟動應用程式（之後直接雙擊 `Smart Screen OCR.app` 即可）。
3. **開啟「螢幕錄製」權限**：
   - 首次於新 Mac 執行截圖時，請前往 **「系統設定 → 隱私權與安全性 → 螢幕錄製」** 勾選 `Smart Screen OCR`（或點左下角 `+` 加入隨身資料夾中的 `Smart Screen OCR.app`）並重新啟動程式。

### 如何產出 macOS 行動免安裝版
- **在 Mac 本機打包**：
  ```bash
  npm run build:mac-portable
  # 或直接執行：
  chmod +x scripts/package-mac-portable.sh && bash scripts/package-mac-portable.sh
  ```
  執行完成後即於 `dist/` 產生 `Smart-Screen-OCR-macOS-arm64-Portable.zip` 與 `Smart-Screen-OCR-macOS-x64-Portable.zip`。
- **沒有 Mac 也能打包（GitHub Actions 雲端建置）**：
  執行專案內建的 [`.github/workflows/build-desktop.yml`](./.github/workflows/build-desktop.yml) 後，直接於 GitHub Actions 的 **Artifacts** 下載 **`Smart-Screen-OCR-macOS-Portable`** 即可！

---

## 🖥️ 標準安裝與首次權限設定指南

### 一、Windows 使用者安裝步驟

1. **選擇版本**：
   - **標準安裝版**：執行 `Smart Screen OCR Setup x.x.x.exe`，可自訂安裝路徑並自動建立桌面與開始功能表捷徑。
   - **免安裝可攜版**：直接執行 `Smart Screen OCR-x.x.x-Portable-x64.exe`，無需安裝即可使用；程式會自動在同層 `portable-data/` 儲存設定，方便隨身攜帶。
2. **首次執行 SmartScreen 提示處理**（未簽章版本）：
   - 若 Windows Defender SmartScreen 顯示「Windows 已保護您的電腦」，請點擊 **「其他資訊」→「仍要執行」** 即可啟動。
3. **開始使用**：
   - 啟動後應用程式常駐於右下角系統匣（Tray），隨時按下快捷鍵 **`Alt+Shift+S`** 啟動凍結截圖，或點擊系統匣圖示開啟設定視窗輸入您的 **Google Gemini API Key** 或 **OpenAI API Key**。

---

### 二、macOS 標準安裝版 (`.dmg`) 安裝與權限設定步驟

若您下載的是標準安裝版 `.dmg`（同時支援 Apple Silicon `arm64` 與 Intel `x64`）：

#### 步驟 1：安裝應用程式
開啟下載的 `.dmg` 映像檔，將 **Smart Screen OCR.app** 拖曳至 **「應用程式 (Applications)」** 資料夾。

#### 步驟 2：解除未簽章應用程式的系統阻擋（重要）
若安裝檔為本機或 GitHub Actions 建置之未經 Apple Developer 公證簽章版本，首次開啟時 macOS Gatekeeper 可能會提示「已損毀」或「無法驗證開發者」。請開啟「終端機 (Terminal)」並執行以下指令移除隔離屬性：

```bash
xattr -cr "/Applications/Smart Screen OCR.app"
```

執行完成後即可正常雙擊開啟 **Smart Screen OCR**。

#### 步驟 3：開啟「螢幕錄製」隱私權權限（必要）
macOS 基於系統安全機制，擷取桌面視窗畫面必須獲得「螢幕錄製」授權（若未授權，凍結截圖時僅會看到桌面背景而看不到其他視窗）：

1. 開啟 macOS **「系統設定 (System Settings)」**。
2. 前往左側選單 **「隱私權與安全性 (Privacy & Security)」→「螢幕錄製 (Screen Recording)」**（也可直接點擊應用程式設定頁中的引導按鈕一鍵開啟）。
3. 找到 **Smart Screen OCR** 並開啟右側開關（若清單中尚未出現，可點擊左下角 **`+`** 手動加入 `/Applications/Smart Screen OCR.app`）。
4. 系統提示需要重新啟動應用程式時，點擊 **「結束並重新開啟」**，權限即刻生效！

---

## 🚀 開發模式啟動方式

請先確認本機已安裝 **Node.js 20 LTS**（含 `npm`）。

### 方式 A：一鍵啟動腳本（推薦）
- **Windows**：直接雙擊專案根目錄下的 [`start-win.bat`](./start-win.bat)（自動偵測並安裝相依套件後啟動）。
- **macOS**：首次使用先於終端機賦予執行權限，之後即可於 Finder 直接雙擊啟動：
  ```bash
  chmod +x start-mac.command
  ./start-mac.command
  ```

### 方式 B：終端機指令啟動與測試
```bash
# 1. 安裝相依套件
npm install

# 2. 執行自動化測試套件
npm test

# 3. 以開發模式啟動桌面應用程式
npm start
```

---

## 📦 跨平台打包建置教學

本專案的打包規則集中定義於 [`electron-builder.yml`](./electron-builder.yml)，並已配置完整圖示資產（`assets/icon.ico`、`assets/icon.icns`、`assets/icon.png`、`assets/tray-icon*.png`）與 macOS Hardened Runtime 權限檔（[`build/entitlements.mac.plist`](./build/entitlements.mac.plist)）。

### 1. 在 Windows 本機打包 `.exe`

```bash
# 僅產生免封裝測試目錄（dist/win-unpacked/Smart Screen OCR.exe，速度最快）
npm run build:win-dir

# 產生完整 Windows x64 NSIS 安裝檔與免安裝可攜版 (.exe)
npm run build:win
```

> **提示**：`electron-builder.yml` 已預設設定 `win.signAndEditExecutable: false`，因此即使本機沒有程式碼簽章憑證、也未開啟 Windows 開發人員模式，仍可 100% 順利完成打包。若您日後具備正式簽章憑證並於支援符號連結的環境建置，可將該項目調整為 `true`。

### 2. 在 macOS 本機打包標準安裝檔與行動免安裝版

> 注意：macOS 的 `.app`、`.dmg` 與行動免安裝版 `.zip` 必須在 macOS 環境（或 GitHub Actions `macos-latest`）下建置。

```bash
# 建置 Apple Silicon (arm64) 與 Intel (x64) 的標準 .dmg 與 .zip 安裝檔
npm run build:mac

# 建置 Apple Silicon (arm64) 與 Intel (x64) 的行動免安裝版 Portable ZIP
npm run build:mac-portable
```

產出檔案位於 `dist/` 目錄下：
- 標準安裝檔：`Smart Screen OCR-x.x.x-arm64.dmg`、`Smart Screen OCR-x.x.x.dmg` 與對應 `.zip`
- 行動免安裝版：`Smart-Screen-OCR-macOS-arm64-Portable.zip`、`Smart-Screen-OCR-macOS-x64-Portable.zip`

### 3. 使用 GitHub Actions 雲端自動建置 Windows 與 macOS 雙平台安裝檔

即使手邊只有 Windows 電腦（沒有 Mac），也能透過內建的 GitHub Actions 工作流程 [`.github/workflows/build-desktop.yml`](./.github/workflows/build-desktop.yml) 自動在雲端同時建置 **Windows `.exe`**、**macOS 標準 `.dmg` / `.zip`** 與 **macOS 行動免安裝版 (`Portable.zip`)**！

1. 將 `smart-screen-ocr-desktop` 目錄作為 Git 儲存庫推送至您的 GitHub 專案（確保 `.github/workflows/build-desktop.yml` 位於儲存庫根目錄下的 `.github/workflows/`）。
2. 觸發建置（任選一種方式）：
   - **手動觸發**：進入 GitHub 儲存庫的 **Actions** 分頁 → 點選左側 **「Build Smart Screen OCR Desktop」** → 點擊 **「Run workflow」**。
   - **標籤自動觸發**：於本機建立並推送 `v` 開頭的版本標籤（例如 `git tag v1.0.0 && git push origin v1.0.0`）。
3. 等待兩個平行作業（`Build Windows` 與 `Build macOS`）執行完成後，於該次執行的 **Artifacts** 區塊即可直接下載：
   - `smart-screen-ocr-windows-x64`（內含 Windows `.exe` 安裝檔與免安裝可攜版）
   - `smart-screen-ocr-macos-arm64-x64`（內含 macOS `arm64` 與 `x64` 的標準 `.dmg` 與 `.zip`）
   - `Smart-Screen-OCR-macOS-Portable`（內含 macOS `arm64` 與 `x64` 的**行動免安裝版 `.zip`**，解壓即可攜帶使用！）

---

## ❓ 常見問題排解 (FAQ)

- **Q：為什麼按下預設快捷鍵 `Alt+Shift+S` 沒有反應？**
  - 請確認該快捷鍵是否被其他系統軟體佔用。您可在設定視窗的「快捷鍵設定」欄位重新錄製一組不衝突的全域快捷鍵（例如 `Ctrl+Shift+S`、`Alt+Q` 或 `F8`）。
- **Q：macOS 截圖畫面只看到桌面桌布、看不到其他視窗？**
  - 代表尚未完成 macOS「螢幕錄製」權限授權，請前往「系統設定 → 隱私權與安全性 → 螢幕錄製」勾選 **Smart Screen OCR** 並**重新啟動應用程式**。
- **Q：AI 文字辨識顯示缺少 API Key？**
  - 請點擊系統匣圖示開啟設定頁，填入您的 **Google Gemini API Key**（可於 Google AI Studio 免費申請）或 **OpenAI API Key** 並點擊儲存。
- **Q：如何切換更自然的語音朗讀聲線？**
  - 程式預設已啟用 **Edge 自然神經語音 (`edge-neural`)**（免費免金鑰，提供台灣女聲「曉臻」、男聲「雲哲」等自然聲線）；您也可以在設定頁切換為 **Google Gemini 官方自然語音** 或離線可用的 **系統地端語音**，並即時調整語速滑桿。
- **Q：行動免安裝版如何確認設定真的存在隨身資料夾中？**
  - 開啟設定視窗後，若頂部系統狀態列出現「🎒 行動免安裝模式」徽章，代表設定正儲存於程式同層的 `portable-data/settings.json`。
