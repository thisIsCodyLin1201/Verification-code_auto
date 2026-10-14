#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '找不到 Node.js。請先從 https://nodejs.org 安裝 LTS 版本（24 或以上）。'
else
  node scripts/setup.mjs
fi
printf '\n按 Enter 關閉此視窗…'
read -r response
