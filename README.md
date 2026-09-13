# 萌獸鬥技場 Beast Brawl

回合制指令 × 街機格鬥演出。此儲存庫收錄目前的 **V9 — Ultimate Overhaul Edition**。

## 網頁試玩

GitHub Pages 啟用並部署完成後，遊戲網址為：

**https://xdxd-lab.github.io/beast_fighter/**

若網址顯示 404，請先完成下方的第一次啟用設定；上傳程式碼不代表 Pages 已啟用。

## 第一次啟用 GitHub Pages

開啟 [Settings → Pages](https://github.com/xdxd-lab/beast_fighter/settings/pages)，在 **Build and deployment** 區塊設定：

- **Source**：Deploy from a branch
- **Branch**：main
- **Folder**：/ (root)

按 **Save**，等待部署完成後，再從 Pages 頁面按 **Visit site**。往後更新 `main` 分支的 `index.html`，即可沿用同一個遊戲網址。

官方說明：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 玩法

選擇雙方角色與異色造型，按「FIGHT! 開始對戰」。雙方各自選擇行動後，依速度與技能優先度結算；對手 HP 歸零即獲勝。

支援 **1P vs CPU** 與 **1P vs 2P 雙人同機**。目前沒有跨裝置連線對戰；不同裝置開啟同一個網址，會各自執行遊戲。

六名角色：北極熊／烈焰法師、大象／遠擊砲手、熊貓／疾影刺客、蜂鳥／巨槌狂戰士、虎鯨／深海吟遊詩人、水母／重裝聖騎士。

## 檔案

- `index.html`：V9 遊戲完整內容，對應原始檔 `moe_beast_turn_fighter_v9.html`。HTML、CSS、JavaScript 與角色 SVG 都包含在同一檔案中。
- `.nojekyll`：讓 GitHub Pages 直接提供靜態檔案。

不需要 npm、建置工具、後端伺服器或外部 JavaScript 套件。也可以下載 `index.html`，在支援本機 HTML 執行的瀏覽器中離線遊玩。

本次發布只整理網站入口與說明，沒有修改角色、技能、數值或動畫程式。設計參考保留在遊戲內的 **Reference** 按鈕中。
