#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '請先執行「安裝 Chrome 插件.command」。'
else
  print '請保持此視窗開啟，再用 Chrome 前往 http://127.0.0.1:8765'
  print '停止測試頁：按 Control-C。'
  node scripts/serve.mjs
fi
printf '\n按 Enter 關閉此視窗…'
read -r response
