# 先進顯微鏡技術實驗室 · 內部知識庫

明志科技大學化工系 化306-1。指導教授：杜鶴芸。

線上網址：<https://ja5min3.github.io/lab-page/>

## 這個 repo 是什麼

單一自持檔案 `index.html`，沒有建置流程、沒有相依套件、沒有外部字型或 CDN，
存起來離線也能開。GitHub Pages 從 `main` 分支自動部署，推上去約 40 秒後生效。

## 來源與同步

- **這個 repo 是部署來源。** 線上網頁一律從 `main` 的 `index.html` 產生，
  要改網頁就改這裡，改完推 `main`。
- **vault 保留同步鏡像。** 第二大腦（Obsidian）內的「實驗室網頁.html」是這份檔案的
  鏡像，方便離線閱讀與版本留存。**它是鏡像，不是編輯來源。**
- 兩邊要保持一致：改完 repo 後，把 `index.html` 覆蓋回 vault 那份鏡像。
  反過來從 vault 覆蓋 repo 之前，先確認 vault 那份確實比 `main` 新，
  否則會把線上版本蓋掉。

## 頁面結構

單檔內用 hash 路由分頁，網址可以直接分享到某一區：

| 網址 | 內容 |
|---|---|
| `#home` | 首頁，七張入口卡 |
| `#print` | 3D 列印區總覽 |
| `#d-h2d` `#d-ender` `#d-s050` | 三台機器的操作細節 |
| `#d-exam` | 使用考核制度 |
| `#inventory` | 耗材盤點 |
| `#safety` `#d-check` | 安全與檢查、自主檢查八項 |
| `#waste` `#buy` `#members` `#rules` | 廢液、採購、成員、其他規則 |

路由是漸進增強的：CSS 預設顯示所有區塊，JS 啟動後才隱藏非當前分頁。
**停用 JavaScript 時會退回一頁到底的長捲頁，不會變空白。**

## 耗材盤點的資料存在哪裡

這是靜態頁面，沒有伺服器。盤點資料存在**瀏覽器的 localStorage**，
key 為 `lab-inventory-v1`，綁定瀏覽器與網址。

- 只有在同一台電腦、同一個瀏覽器看得到，換人或換機器不會同步
- 清除瀏覽器資料會一併清掉
- **備份與交接靠頁面上的「匯出 CSV」**，到新的地方用「匯入 CSV」讀回來

改動 `index.html` 時，以下不能更名，否則使用者已輸入的庫存會讀不到或功能失效：

- localStorage key：`lab-inventory-v1`
- DOM id：`inv-form` `inv-cat` `inv-name` `inv-spec` `inv-qty` `inv-unit` `inv-note`
  `inv-submit` `inv-cancel` `inv-search` `inv-filter` `inv-export` `inv-import`
  `inv-import-btn` `inv-clear` `inv-body` `inv-empty` `inv-summary`

## 設計慣例

- 配色深海軍藍，色票集中在 `:root` 的 CSS 變數
- **等寬字只給「量」用**：數字、單位、規格、統計走 `--mono`，中文敘述走黑體
- 每個區塊標題下的「標尺」右側標出該區真正的量（3 台機器、8 項檢查…），
  耗材盤點那條會即時反映目前品項數
- 提示框預設用安靜的藍（`.note`），琥珀色（`.note--risk`）只留給真正有風險的地方
- 標題不放 emoji
- 最小字級 14px（根字級 18px，即 `.78rem`）——這頁常常是站在機器旁邊用手機看的
