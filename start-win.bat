@echo off
REM ============================================================================
REM Smart Screen OCR 桌面版 - Windows 開發模式一鍵啟動腳本
REM 功能：自動檢查 Node.js 環境、於首次執行時安裝相依套件，並啟動 Electron 應用程式
REM ============================================================================

REM 切換主控台編碼為 UTF-8，確保繁體中文提示訊息正確顯示
chcp 65001 >nul

REM 切換工作目錄至本腳本所在資料夾
cd /d "%~dp0"

echo ==================================================
echo   Smart Screen OCR 桌面版 - Windows 啟動工具
echo ==================================================
echo.

REM 檢查是否已安裝 Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 找不到 Node.js！請先前往 https://nodejs.org/ 下載並安裝 Node.js 20 LTS。
    echo.
    pause
    exit /b 1
)

REM 檢查是否已安裝 npm
where npm >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 找不到 npm 指令，請確認 Node.js 安裝完整並已加入系統 PATH。
    echo.
    pause
    exit /b 1
)

REM 若尚未安裝 node_modules，自動執行 npm install
if not exist "node_modules" (
    echo [資訊] 偵測到尚未安裝相依套件，正在執行 npm install ...
    call npm install
    if errorlevel 1 (
        echo [錯誤] 相依套件安裝失敗，請檢查網路連線或錯誤訊息。
        echo.
        pause
        exit /b 1
    )
    echo [完成] 相依套件安裝完成！
    echo.
)

REM 以開發模式啟動 Electron 桌面應用程式
echo [啟動] 正在開啟 Smart Screen OCR 桌面應用程式...
call npm start

REM 若程式異常結束，暫停畫面以便檢視錯誤訊息
if errorlevel 1 (
    echo.
    echo [錯誤] 應用程式異常結束，錯誤碼：%errorlevel%
    pause
    exit /b %errorlevel%
)
