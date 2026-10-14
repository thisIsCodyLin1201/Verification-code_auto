# 實際驗證紀錄

日期：2026-10-06。環境：macOS arm64，Node.js v26.10.0。Chrome 安裝於 `/Applications/Google Chrome.app`，未能啟動，未取得版本。

| 項目 | 實際結果 |
|---|---|
| `npm test` | 21/21 通過。純邏輯、模擬 Chrome API／worker／canvas；不是真實 OCR |
| `npm run build:ui` | 成功；`dist-ui/` 可檢查 UI，OCR unavailable |
| `npm run assets` | 失敗：fetch failed；curl 另確認 registry.npmjs.org DNS 無法解析 |
| `npm run build` | 失敗：缺少 api/dist/tesseract.min.js；完整 dist 未產生 |
| `npm run test:browser` | 未驗證：listen EPERM 127.0.0.1 |
| Chrome headless 獨立 smoke test | process exit 134，未產出可驗證頁面 |
| React/Vue controlled form | 測試頁與腳本已提供；未實際執行 |
| 真實 OCR／CSP／離線／縮放／HiDPI | 未驗證 |
| 冷啟動／暖機 20 次 p50/p95／UI 響應 | 未量測；評估腳本已提供 |
| CPU／記憶體 | 未量測；README 提供 Task Manager 流程 |
| 代表性驗證碼準確率 | 未評估；沒有代表性資料 |

單元／模擬整合涵蓋：實際 screenshot 比例與分數座標、反向框選／無效裁切、逐像素差異／尺寸差異、前導零與長度驗證、bytes/pixels 限制、origin/path 精確匹配與多設定、single active request/session、capture 前目標變更、A/B mismatch、tab switch／navigation、duplicate begin、offscreen 像素比較、超限時不初始化 worker、逾時终止、閒置釋放／重建、取消舊回應、初始化失敗恢復、單 worker 重用與三版本上限。

UI-only 套件沒有真實辨識能力；產品程式碼沒有 mock provider fallback。必須先下載資源並 build，再執行 README 的完整 Chrome 驗收。沒有把合成樣本、mock 結果或 confidence 當作真實準確率。

## 2026-10-14 接續開發

新增 Finder 可雙擊的安裝／測試頁啟動程式、繁體中文操作說明、可重用下載快取、每項資源 SHA-512 校驗、套件版本／WASM／gzip 檢查、暫存建置後替換輸出、安裝包 SHA-256 inventory 與 verifier。安裝完成才提示載入 dist；UI-only popup 明確標示資源尚未安裝。

修正：截圖由 data URL 直接解碼 Blob，移除會受 connect-src 限制的 fetch(data:)；設定讀取失敗後清除 active request；設定讀取／offscreen 建立期間可取消；取消等待 offscreen 建立後關閉；不讓舊 document／heartbeat／END 回應影響新操作；worker 參數初始化失敗時終止並允許重建。

- `npm test`：**31/31 通過**（單元及模擬整合）。新增下載損毀／lock 異常、UI-only verifier 拒絕、CSP 相容解碼、初始化參數失敗、settings 失敗復原、初始化中取消、document 隔離測試。
- `npm run build:ui`：成功；已更新 `dist-ui/`，仍不具真實 OCR。
- `npm run assets`：仍失敗，明確錯誤 `ENOTFOUND registry.npmjs.org`。
- `npm run test:browser`：仍未驗證，`listen EPERM 127.0.0.1`。
- 完整 `dist/`、資源 lock、真實 OCR／Chrome／離線／效能：仍待資源安裝與執行，沒有編造結果。
- 本機安裝工具的 JavaScript 與兩個 `.command` 已通過語法檢查；尚未驗證成功下載的完整安裝路徑。

下一個必要動作：使用者在一般 Mac Finder 雙擊「安裝 Chrome 插件.command」，成功後再驗證完整 dist 與 Chrome 實際辨識。`reports/setup-latest.log` 留存該次輸出供排錯，不含網站資料。


## 2026-10-14 v0.1.1：工具列直接選圖

使用者回報先前版本已順利掛載使用；實際檢查已存在資源 cache、assets.lock.json 與成功的 setup log。本次直接使用已有資源建立完整套件。

- 變更：移除 action default_popup，工具列 onClicked 直接注入並對該 document 開啟選圖；底部提供框選、已存設定／面板與取消。受限制頁面顯示 badge 與 title 錯誤。
- `npm test`：**33/33 通過**。新增工具列直接啟動／document 定向與不支援頁面／注入失敗測試。
- `npm run build`：成功，完整 `dist/` 版本 **0.1.1**。
- `npm run verify`：成功，**26 個打包檔案**通過 SHA-256 與資源清單檢查。
- `npm run build:ui`：同步更新 UI-only 套件。
- 新版實際工具列 UI 未由開發環境執行 Chrome 驗證。需使用者重新載入擴充功能並重新整理網頁試用；沒有將 mock 測試當作 UI 實測。
- OCR engine 不變：Tesseract.js 6.0.1，本地單 worker、原圖／放大／灰階、數字 whitelist、嚴格 A/B 檢查。真實準確率及效能尚未評估。


## 2026-10-14 v0.2.0：較高精度模型與英文支援

- 原始碼已改為 tessdata_best/eng 浮點 LSTM、本機未壓縮 traineddata，固定官方 commit 與 blob ID、檔案大小及 Apache 授權。安裝器補抓模型；缺少／損毀即停止，完整 build 不會替換既有 dist。
- 預設英數大小寫、可切純數字，模式隨設定保存並綁定當次辨識與填入；重用 worker 時重設 whitelist。三版本大小寫不一致須人工確認，保留前導零。
- `npm test`：41/41 通過。新增英數字元／長度限制、大小寫保留／不一致、worker 模式切換、background/offscreen 傳遞、模型來源校驗與不完整下載拒絕測試。這些使用 mock OCR，不能代表模型準確率。
- `npm run build:ui`：成功（不具辨識能力）。
- 模型下載：`ENOTFOUND`，GitHub 檔案工具不支援此二進位檔；官方授權檔已取得。新版完整 build 尚待模型；原有 dist 保留 0.1.1。
- 真實模型初始化、Chrome 擴充功能流程、大小寫圖片辨識與 CPU／記憶體／延遲：未驗證。測試頁新增 A7b3Z9，評估工具接受區分大小寫的英數標註與每筆字元模式。
- 使用者下一步：雙擊「安裝 Chrome 插件.command」，成功後 Chrome 重新載入插件並重新整理網站。模型約 15.4 MB；新模型不是針對驗證碼專門訓練，沒有宣稱準確率保證。


## 2026-10-14：實際使用回饋與 GitHub 文件整理

- 後續安裝已成功：setup log 與 dist/BUILD-STATUS.json 顯示完整版本 0.2.0，已打包 tessdata_best/eng。先前「模型待下載」為歷史狀態。
- 本次 `npm run verify` 通過：27 個打包檔案、模型來源及完整性檢查通過。
- 使用者回報辨識效果很差，認為專案可能失敗。README 將目前結果定義為「未達到可靠辨識目標的實驗原型」。沒有將這項定性回饋轉換為虛構準確率，也沒有把問題歸因於已驗證的單一因素。
- 未取得新舊模型對照資料或代表性圖片標註；Chrome 實際載入版本與特定失敗圖片尚未逐一核對。
- 本次僅修改文件與 Git 排除規則；未改動辨識程式。README 已檢查本機相對連結與指令名稱，未重跑程式測試；41 項通過為前次驗證紀錄。
