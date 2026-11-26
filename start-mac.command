#!/usr/bin/env bash
# ==============================================================================
# Smart Screen OCR 桌面版 - macOS 開發模式一鍵啟動腳本
# 使用方式：
#   1. 首次使用請先於終端機賦予執行權限：chmod +x start-mac.command
#   2. 之後即可直接在 Finder 雙擊此檔案啟動桌面應用程式
# ==============================================================================

set -e

# 切換工作目錄至本腳本所在資料夾
cd "$(dirname "$0")"

# 補齊 macOS 常見 Node.js 安裝路徑（Homebrew / Intel / nvm），避免從 Finder 雙擊時找不到 node
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | tail -n 1)/bin:$PATH"

echo "=================================================="
echo "  Smart Screen OCR 桌面版 - macOS 啟動工具"
echo "=================================================="
echo ""

# 檢查是否已安裝 Node.js 與 npm
if ! command -v node >/dev/null 2>&1; then
  echo "[錯誤] 找不到 Node.js！請先透過 https://nodejs.org/ 或 Homebrew (brew install node) 安裝 Node.js 20 LTS。"
  read -r -p "請按 Enter 鍵關閉視窗..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[錯誤] 找不到 npm 指令，請確認 Node.js 環境設定正確。"
  read -r -p "請按 Enter 鍵關閉視窗..."
  exit 1
fi

# 若尚未安裝 node_modules，自動執行 npm install
if [ ! -d "node_modules" ]; then
  echo "[資訊] 偵測到尚未安裝相依套件，正在執行 npm install ..."
  npm install
  echo "[完成] 相依套件安裝完成！"
  echo ""
fi

# 啟動 Electron 桌面應用程式
echo "[啟動] 正在開啟 Smart Screen OCR 桌面應用程式..."
npm start
