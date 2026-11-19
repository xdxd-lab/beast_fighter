# 架構說明

本文件說明 Beast Brawl V10 的模組分工、資料流與主要設計決策，供日後維護與擴充參考。

## 設計原則

1. **零相依、零建置**：不使用 bundler、框架或 CDN。所有檔案以傳統 `<script src>` 依序載入，同一份檔案可以直接放上 GitHub Pages，也能用 `file://` 離線開啟（ES modules 與 `fetch` 在 `file://` 會被 CORS 擋下，所以刻意不用）。
2. **規則與演出分離**：戰鬥規則是純函式，不碰 DOM，可以在 Node 測試；控制器只負責「怎麼演」。
3. **可重現**：所有隨機都經過 `state.rng`。給定種子，就能重播同一場戰鬥。
4. **一定能玩**：音訊、儲存空間、粒子特效失敗時都會安靜退回，不會中斷遊戲。

## 模組與載入順序

```
settings.js ─┐
roster.js  ──┼─> engine.js ──┐
             │               ├─> main.js（控制器）
sprites.js ──┤   audio.js ───┤
             │   particles.js┤
             └   touch.js ───┘
```

每個檔案都是 IIFE，掛在全域命名空間 `window.BeastBrawl` 底下：

| 模組 | 命名空間 | 職責 | Node 可載入 |
| --- | --- | --- | :---: |
| `js/core/settings.js` | `BeastBrawl.Settings` | 設定存取、驗證、訂閱通知、`localStorage` 失敗時退回預設值 | — |
| `js/data/roster.js` | `BeastBrawl.Roster` | 角色、技能、共用指令 | ✅ |
| `js/core/engine.js` | `BeastBrawl.Engine` | 規則常數 `RULES`、回合順序、行動結算、狀態、勝負、CPU AI、`createRng` | ✅ |
| `js/render/sprites.js` | `BeastBrawl.Sprites` | 角色 SVG、技能特效 SVG（1000×520 座標系） | — |
| `js/audio/audio.js` | `BeastBrawl.Audio` | 合成器、音效、BGM 音序器、混音、離線渲染 | — |
| `js/fx/particles.js` | `BeastBrawl.Particles` | Canvas 粒子、自動品質調整 | — |
| `js/fx/touch.js` | `BeastBrawl.TouchFeedback` | 觸控漣漪與多點編號 | — |
| `js/main.js` | `BeastBrawl.Game`（唯讀） | 畫面切換、對戰演出、HUD、指令、對話框、鍵盤 | — |

`roster.js` 與 `engine.js` 使用 UMD 包裝：瀏覽器掛在命名空間上，Node 透過 `module.exports` 輸出。

## 一個回合的資料流

```
beginRound()
  └ Engine.startRound(state)            清除防禦、結算中毒
  └ 顯示指令（或 CPU／觀戰自動選擇）
chooseAction(side, skill)
  └ Engine.cpuChooseAction()            CPU 方（失衡時回傳 SKIP 並清除失衡）
resolveRound()
  └ Engine.resolveTurnOrder(state, locked)
  └ for side of order:
       presentAction(side, skill)
         └ outcome = Engine.resolveAction(state, side, skill)   先決定結果並更新狀態
         └ showCutin() / playFiveFrameAction(outcome)           再依結果演出
         └ 飄字、紀錄、HUD
  └ Engine.endRound(state)              遞減攻↓／速↓，回合數 +1
  └ checkEnd() → K.O. 演出 → showResult()
```

`resolveAction` 會回傳純資料物件：`{ kind, hit, damage, absorbed, crit, mpGain, hpGain, shieldGain, statuses }`。控制器不會自己算傷害。

## BattleSession：戰鬥生命週期

每場戰鬥建立一個 `BattleSession`，負責所有時間相關的工作：

- `wait(ms)`：可中止的延遲，在 session 結束後 reject 為 `ABORTED`。
- `later(fn, ms)`：session 還在時才執行的延遲回呼。
- `timeline(duration, onFrame)`：rAF 驅動的時間軸，支援 `control.hold(ms)`（命中停頓）。分頁從背景回來、單格間隔超過 250 ms 時，直接跳到結尾。
- `tempo`：戰鬥倍速。上述三者都以 1× 撰寫時間，再除以 `tempo`。
- `dispose()`：清掉所有計時器與時間軸。

最上層的 `resolveRound().catch(ignoreAbort)` 會吞掉 `ABORTED`。因此離開或重開對戰時，舊的協程會在下一個 `await` 停下，不會碰到新的一場。

## 渲染與效能

- **舞台**：DOM（角色 SVG、橫幅、cut-in）、一層常駐的特效 SVG（每步只替換 `<g>` 內容），加上一層 Canvas 粒子。
- **合成成本**：舞台宣告 `contain: layout paint` 與 `isolation: isolate`，角色只提升 `transform`；HP／MP 條用 `scaleX`；畫面內的元素不使用 `backdrop-filter`。
- **品質分級**：`html[data-quality]` 為 `high` 或 `low`。`low` 由 CSS 關閉混色、背景模糊與掃描線，由 JS 略過殘影並縮小粒子上限。設定為「自動」時，粒子系統偵測到平均每格超過約 24 ms，就會自動切到 `low`。
- **減少動態效果**：`html[data-motion="reduced"]` 由 CSS 停用閃光與待機循環動畫；畫面震動、鏡頭推近與殘影則在 JS 端略過，粒子數量也會減少。

## 測試策略

| 層級 | 工具 | 涵蓋範圍 |
| --- | --- | --- |
| 單元 | `node --test tests/*.test.js` | 角色資料完整性、RNG、回合順序、傷害公式、被動、狀態、勝負、CPU AI、重播一致性、36 組對戰都能結束 |
| 端到端 | `scripts/qa/smoke_test.py`（headless Chrome，透過 CDP 控制） | 選角、觀戰打到結算、純鍵盤對戰、中途重開、console 錯誤、390 px 版面 |
| 音訊 | `scripts/qa/audio_check.py` | 離線渲染後量測 300 Hz 以上響度，輸出 WAV 試聽檔 |

QA 腳本只用 Python 標準函式庫，內建一個最小的 CDP WebSocket client（`scripts/qa/cdp.py`）。這樣本機與 CI 都不需要安裝 Playwright 或 Node 套件。

## 擴充指南

- **新增角色**：在 `roster.js` 加入一筆資料，並在 `sprites.js` 的 `BODIES` 加入對應 SVG；有新被動時，在 `engine.js` 的 `PASSIVE_POWER` 加一列。最後執行 `npm test`，`roster` 測試會檢查資料格式。
- **新增技能特效**：選一個新的 `fx` 名稱，然後依序在 `sprites.js` 的 `effectFrameArt`（畫面）、`particles.js` 的 `FX_FAMILY`／`impact`（粒子）、`audio.js` 的 `CAST`／`IMPACT`（聲音）補上對應內容。
- **調整平衡**：只改 `roster.js` 或 `RULES`。單元測試裡寫死的期望值會提醒你哪些公式結果跟著變了。
