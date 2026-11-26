#!/usr/bin/env bash
# ==============================================================================
# Smart Screen OCR 桌面版 - macOS 行動免安裝版 (Portable Edition) 打包腳本
#
# 功能說明：
#   1. 透過 electron-builder 建置 Apple Silicon (arm64) 與 Intel (x64) 的 .app 套件
#   2. 為每個架構建立獨立隨身資料夾 Smart-Screen-OCR-macOS-<arch>-Portable/，內含：
#      - Smart Screen OCR.app（使用 ditto 完整保留符號連結與執行權限）
#      - portable-data/（隨身設定資料夾，主程式偵測到此目錄即自動啟用行動免安裝模式）
#      - 首次開啟免安裝版.command（雙擊自動執行 xattr -cr 解除隔離標記並開啟程式）
#      - 行動免安裝使用說明.txt（簡明繁體中文操作與權限指引）
#   3. 使用 macOS 原生 ditto 壓縮為標準 ZIP，確保權限與資源分叉完好：
#      - dist/Smart-Screen-OCR-macOS-arm64-Portable.zip
#      - dist/Smart-Screen-OCR-macOS-x64-Portable.zip
#
# 使用方式：
#   chmod +x scripts/package-mac-portable.sh
#   bash scripts/package-mac-portable.sh
#   （若已先建置過 dist/mac*，可加上 --skip-build 跳過 electron-builder 步驟）
# ==============================================================================

set -euo pipefail

# 檢查是否於 macOS 環境執行（建立 .app 與 ditto 壓縮需使用 macOS 系統工具）
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[錯誤] 此腳本必須在 macOS 環境執行（目前系統：$(uname -s)）。"
  echo "[提示] 若您手邊為 Windows 電腦，請使用 .github/workflows/build-desktop.yml 透過 GitHub Actions 雲端建置 macOS 行動免安裝版。"
  exit 1
fi

# 切換至專案根目錄（scripts/ 的上一層）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

APP_NAME="Smart Screen OCR.app"
DIST_DIR="$PROJECT_DIR/dist"
STAGE_ROOT="$DIST_DIR/.portable-stage"
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-build)
      SKIP_BUILD=true
      ;;
  esac
done

echo "============================================================"
echo "  Smart Screen OCR - macOS 行動免安裝版 (Portable) 打包工具"
echo "============================================================"

# ------------------------------------------------------------------------------
# 步驟 1：使用 electron-builder 建置 arm64 與 x64 的未封裝 .app 目錄
# ------------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == "false" ]]; then
  echo "[1/3] 正在建置 macOS arm64 與 x64 的 .app 套件..."
  # 若外部未指定簽章探索行為，預設停用自動簽章探索以支援免憑證建置
  export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
  npx electron-builder --mac dir --arm64 --x64 --config electron-builder.yml
else
  echo "[1/3] 已指定 --skip-build，直接使用現有的 dist/mac* 建置結果..."
fi

# ------------------------------------------------------------------------------
# 步驟 2：為指定架構組裝隨身免安裝資料夾並以 ditto 壓縮成 ZIP
# ------------------------------------------------------------------------------
package_arch() {
  local arch="$1"
  local arch_label="$2"
  local app_src="$3"

  if [[ ! -d "$app_src" ]]; then
    echo "[警告] 找不到 ${arch} 的應用程式套件（${app_src}），略過此架構。"
    return 1
  fi

  local folder_name="Smart-Screen-OCR-macOS-${arch}-Portable"
  local stage_dir="${STAGE_ROOT}/${folder_name}"
  local zip_out="${DIST_DIR}/${folder_name}.zip"

  echo "[2/3] 正在組裝 ${arch_label} (${arch}) 行動免安裝資料夾..."
  rm -rf "$stage_dir" "$zip_out"
  mkdir -p "$stage_dir/portable-data"

  # 使用 ditto 完整複製 .app，確保內含框架符號連結與可執行權限不遺失
  ditto "$app_src" "$stage_dir/$APP_NAME"

  # 建立 portable-data/.keep 與說明檔，讓主程式啟動時自動辨識為行動免安裝模式
  cat <<'EOF' > "$stage_dir/portable-data/.keep"
Smart Screen OCR Portable Data Marker
EOF

  cat <<'EOF' > "$stage_dir/portable-data/關於此資料夾.txt"
Smart Screen OCR 行動免安裝模式資料夾 (portable-data)
========================================================

只要此「portable-data」資料夾與「Smart Screen OCR.app」位於同一層目錄，
程式啟動時便會自動進入「行動免安裝模式 (Portable Mode)」：

1. 所有個人設定（Gemini / OpenAI API Key、全域快捷鍵、介面主題配色、
   語音朗讀引擎與語速）皆會儲存在此資料夾的 settings.json 內。
2. 不會將個人設定寫入宿主 Mac 的 ~/Library/Application Support/。
3. 將整個外層資料夾複製到隨身碟、外接 SSD 或雲端同步資料夾，
   即可在不同 Mac 電腦間無縫帶著走。

※ 請勿刪除此資料夾；若移除此資料夾，程式將恢復為一般系統設定路徑。
EOF

  # 建立一鍵解除 Gatekeeper 隔離並啟動的 .command 腳本
  cat <<'EOF' > "$stage_dir/首次開啟免安裝版.command"
#!/usr/bin/env bash
# ==============================================================================
# Smart Screen OCR macOS 行動免安裝版 - 首次解除安全隔離並啟動腳本
# 說明：針對未經 Apple 公證之本機／CI 建置版本，自動執行 xattr -cr 移除下載隔離標記，
#       並確保 portable-data 資料夾存在後立即啟動 Smart Screen OCR.app。
# ==============================================================================

set -euo pipefail

# 切換至本腳本所在資料夾（支援任意路徑與隨身碟位置）
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE_DIR"

APP_PATH="$BASE_DIR/Smart Screen OCR.app"
PORTABLE_DIR="$BASE_DIR/portable-data"

echo "============================================================"
echo "  Smart Screen OCR - macOS 行動免安裝版首次啟動工具"
echo "============================================================"
echo ""

if [[ ! -d "$APP_PATH" ]]; then
  echo "[錯誤] 在目前資料夾找不到「Smart Screen OCR.app」！"
  echo "請確認此腳本與「Smart Screen OCR.app」位於同一層資料夾內。"
  read -r -p "請按 Enter 鍵關閉視窗..."
  exit 1
fi

# 確保隨身設定資料夾存在，啟動後自動啟用行動免安裝模式
mkdir -p "$PORTABLE_DIR"

# 移除 macOS 下載隔離屬性 (com.apple.quarantine)，避免 Gatekeeper 誤判「已損毀」
echo "[1/2] 正在解除 macOS 下載隔離標記 (xattr -cr)..."
xattr -cr "$APP_PATH" || true
echo "[完成] 隔離標記已清除！"
echo ""

# 開啟桌面應用程式
echo "[2/2] 正在啟動 Smart Screen OCR（行動免安裝模式）..."
open "$APP_PATH"

echo ""
echo "提示："
echo "  1. 設定檔將自動儲存在同目錄下的 portable-data/settings.json。"
echo "  2. 若首次擷取畫面時只看到桌布，請前往："
echo "     「系統設定 → 隱私權與安全性 → 螢幕錄製」勾選 Smart Screen OCR 後重新開啟。"
echo "  3. 之後直接雙擊「Smart Screen OCR.app」即可開啟，不需重複執行本腳本。"
echo ""
sleep 2
EOF
  chmod +x "$stage_dir/首次開啟免安裝版.command"

  # 建立繁體中文行動免安裝使用說明文字檔
  cat <<EOF > "$stage_dir/行動免安裝使用說明.txt"
Smart Screen OCR - macOS 行動免安裝版 (${arch_label}) 使用說明
====================================================================

一、行動免安裝版特色
--------------------------------------------------------------------
1. 免拖曳安裝：不需將程式放進「應用程式 (Applications)」資料夾，
   直接解壓至任意資料夾、USB 隨身碟、外接硬碟或雲端同步目錄即可執行。
2. 隨身攜帶設定：只要同目錄保留「portable-data」資料夾，您的所有設定
   （API Key、快捷鍵、連動配色主題、Edge/Gemini 語音偏好）都會寫入
   portable-data/settings.json，不會留存在其他人的 Mac 系統目錄中。

二、首次啟動步驟（重要）
--------------------------------------------------------------------
1. 請先雙擊本資料夾內的「首次開啟免安裝版.command」。
   腳本會自動對同目錄的「Smart Screen OCR.app」執行 xattr -cr 解除
   macOS Gatekeeper 下載隔離標記，並直接幫您啟動應用程式。
   （若雙擊時系統提示無法開啟 .command，請右鍵點選 → 選擇「打開」即可。）
2. 之後每次使用直接雙擊「Smart Screen OCR.app」即可。

三、開啟「螢幕錄製」權限（必要）
--------------------------------------------------------------------
macOS 安全機制要求截圖類工具取得「螢幕錄製」權限：
1. 開啟「系統設定」→「隱私權與安全性」→「螢幕錄製」。
2. 勾選「Smart Screen OCR」（或點左下角「+」手動選取本資料夾內的
   Smart Screen OCR.app）。
3. 依系統提示重新啟動應用程式，即可透過全域快捷鍵（預設 Alt+Shift+S）
   凍結螢幕並進行 AI 文字辨識與語音朗讀。

四、隨身攜帶與設定同步建議
--------------------------------------------------------------------
- 換台 Mac 使用時，請將「整個外層資料夾」（含 Smart Screen OCR.app 與
  portable-data/）一併複製或透過隨身碟攜帶。
- 備份設定時，僅需備份 portable-data/settings.json 即可。
EOF

  # 使用 macOS 原生 ditto 壓縮，保留 --sequesterRsrc 資源分叉與符號連結
  echo "[3/3] 正在壓縮產出 ${zip_out} ..."
  ditto -c -k --sequesterRsrc --keepParent "$stage_dir" "$zip_out"
  echo "[成功] 已產生：${zip_out}"
  return 0
}

# 清理舊的暫存目錄
rm -rf "$STAGE_ROOT"
mkdir -p "$STAGE_ROOT"

BUILT_COUNT=0

# 偵測 Apple Silicon (arm64) 輸出路徑
ARM64_APP=""
if [[ -d "$DIST_DIR/mac-arm64/$APP_NAME" ]]; then
  ARM64_APP="$DIST_DIR/mac-arm64/$APP_NAME"
fi

if [[ -n "$ARM64_APP" ]]; then
  if package_arch "arm64" "Apple Silicon M1-M4" "$ARM64_APP"; then
    BUILT_COUNT=$((BUILT_COUNT + 1))
  fi
else
  echo "[警告] 找不到 arm64 建置目錄：$DIST_DIR/mac-arm64/$APP_NAME"
fi

# 偵測 Intel (x64) 輸出路徑（兼容 electron-builder 的 dist/mac 與 dist/mac-x64）
X64_APP=""
if [[ -d "$DIST_DIR/mac-x64/$APP_NAME" ]]; then
  X64_APP="$DIST_DIR/mac-x64/$APP_NAME"
elif [[ -d "$DIST_DIR/mac/$APP_NAME" ]]; then
  X64_APP="$DIST_DIR/mac/$APP_NAME"
fi

if [[ -n "$X64_APP" ]]; then
  if package_arch "x64" "Intel Mac" "$X64_APP"; then
    BUILT_COUNT=$((BUILT_COUNT + 1))
  fi
else
  echo "[警告] 找不到 x64 建置目錄：$DIST_DIR/mac/$APP_NAME 或 $DIST_DIR/mac-x64/$APP_NAME"
fi

# 清除暫存組裝目錄
rm -rf "$STAGE_ROOT"

if [[ "$BUILT_COUNT" -eq 0 ]]; then
  echo "[錯誤] 未成功產出任何 macOS 行動免安裝版壓縮檔，請檢查 dist/ 建置日誌。"
  exit 1
fi

echo ""
echo "============================================================"
echo "  打包完成！共產出 ${BUILT_COUNT} 份 macOS 行動免安裝版："
ls -lh "$DIST_DIR"/Smart-Screen-OCR-macOS-*-Portable.zip
echo "============================================================"
