# Changelog

本專案遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 格式，版本號採用 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Changed

- 背景音樂音量提高約 7 dB（300 Hz 以上 RMS 約 −27 → −20 dB），音效提高約 3 dB 以維持在音樂之上。
- `audio_check.py` 的音樂試聽檔改為完整渲染一整輪樂曲加殘響尾音，不再在樂句中途截斷。

## [10.0.0] — 2026-11-20

V10 把 V9 原型整理成可長期維護、可測試的商業級網頁遊戲。所有角色數值與技能說明維持不變。

### Added

- **音訊**：以 Web Audio 即時合成的介面音、16 種技能效果各自的施放音與依屬性疊加的命中音、回合鑼聲、cut-in、K.O.；原創選角與戰鬥 BGM、勝利音樂；設有混音匯流排、殘響、壓縮與限幅，並依出手方向做左右聲道定位。
- **特效**：Canvas 粒子系統（加色混合、半透明光暈、物件池）、依技能屬性區分的命中特效、半透明護盾泡泡、六角防禦結界、低血量暈影、命中停頓、重擊加強震動、勝利彩帶、場景漂浮微粒。
- **觸控回饋**：沿用 MultiTouchKit `mtk-viewer` 風格的觸控漣漪與多點編號。
- **介面**：延遲扣血 HP 條、護盾條、狀態標籤、戰鬥倍速標示；指令卡加上快捷鍵、類型、威力、命中與 MP 不足提示；選角畫面加上能力值條、技能預覽、隨機選角；結算畫面加上勝者頭像與雙方戰鬥統計。
- **設定對話框**：音量、靜音、戰鬥速度（1×／1.5×／2×）、特效品質（自動／高／省電）、減少動態效果；設定存在 `localStorage`。
- **操作說明對話框**，以及完整的鍵盤操作（<kbd>1</kbd>–<kbd>5</kbd>、<kbd>Enter</kbd>、<kbd>M</kbd>、<kbd>S</kbd>、<kbd>?</kbd>、<kbd>Esc</kbd>）。
- **CPU 觀戰模式**，以及 `mode`、`autostart`、`seed`、`speed`、`mute` 網址參數。
- **無障礙**：skip link、`:focus-visible`、對話框焦點管理與 Tab 循環、`aria-live` 戰鬥紀錄、HP／MP 條 `role="meter"`、遵循「減少動態效果」。
- **SEO 與分享**：description、Open Graph、Twitter Card、canonical、SVG favicon、apple-touch-icon、1200×630 分享預覽圖。
- **測試與 CI**：34 項 Node 單元測試；以 headless Chrome 執行的端到端冒煙測試；GitHub Actions；音量量測與素材產生腳本。
- **授權聲明**：新增 `LICENSE`，明示保留所有權利、未授權他人使用。

### Changed

- 單一 HTML 拆成 `css/` 與 `js/` 模組：純邏輯戰鬥引擎、資料、繪圖、音訊、特效、控制器。仍可用 `file://` 開啟。
- **效能**：動作改在 `requestAnimationFrame` 時間軸播放，特效 SVG 改為常駐節點，姿勢 class 只在改變時更新，HP／MP 條改用 `transform` 動畫，並移除舞台容器層級的混色與場內元素的模糊濾鏡。以同一段固定指令量測，每個指令建立的 DOM 節點減少 47%，Layout 次數減少 21%（已包含新增的 HUD 與特效）。
- CPU 不再於隨機選招時無限疊護盾，或在 MP 幾乎全滿時凝神。
- 凝神的紀錄與飄字改為顯示實際回復的 MP。

### Fixed

- 結算途中按「重新選角」後再開新局，舊的流程會繼續在新的一局出招，或因 `battle` 為 `null` 而報錯；K.O. 結算畫面也可能在選角畫面跳出。
- CPU 被打到失衡時不會跳過回合，失衡技能對 CPU 完全無效。
- 熊貓被動「若本回合先行動」原本是重新擲一次速度判定，與說明不符；現在依實際出手順序判定。
- 角色卡名稱沿用瀏覽器預設的黑色按鈕文字，在深色背景上幾乎看不見。
- 護盾完全吸收傷害時，畫面會顯示「-0」。

## [9.0.0] — 2026-09-13

- 以 V9 Ultimate Overhaul Edition 作為 GitHub Pages 的網頁入口，所有程式都放在單一 `index.html`。

[10.0.0]: https://github.com/xdxd-lab/beast_fighter/compare/508645e...feat/v10-commercial-polish
[9.0.0]: https://github.com/xdxd-lab/beast_fighter/commit/3734eee
