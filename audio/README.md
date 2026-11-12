# 聲音來源（Freesound，CC0）

全部取自 Freesound 的 CC0 錄音（下載的是網站提供的高音質預覽 mp3），再用 `tools/audio-prep.py` 處理成這裡的 AAC（.m4a）。

| 檔案 | 用途 | 來源 id | 作者 | 原標題 | 處理 |
|---|---|---|---|---|---|
| stream.m4a | 湯口流水（循環 45 秒，單聲道，有方位） | [236981](https://freesound.org/s/236981/) | mhtaylor67 | Stream Running Into Pond | 高通 120 Hz |
| birds.m4a | 白天鳥鳴（循環 52 秒） | [518671](https://freesound.org/s/518671/) | jackmichaelking | Numerous birds in Essex Woodland | 取 26 秒起；只留清脆的高音：高通 3 kHz，再用向下擴展把不突出的叫聲壓掉（使用者 2026-11-12 嫌原本鳥太多） |
| crickets.m4a | 夜晚蟲鳴（循環 45 秒） | [175020](https://freesound.org/s/175020/)、[530477](https://freesound.org/s/530477/) | sengjinn、GB01 | AMBIENCE NIGHT FIELD CRICKET 01、Cricket chirping | 遠處一片蟲聲＋偏左一隻近的，高通 1.2 kHz |
| wind.m4a | 風與樹葉（循環 46 秒） | [751473](https://freesound.org/s/751473/) | Borgory | Soft Wind in the Trees - Leaves rustle | 取 82 秒起，高通 180 Hz |
| step_wood.m4a | 木地板赤腳腳步（6 格，每格 0.4 秒） | [403600](https://freesound.org/s/403600/) | LamaMakesMusic | Human_Steps_Barefoot_Wood | 自動偵測起點後切格 |
| step_wade.m4a | 涉水腳步（12 格，每格 0.7 秒） | [861369](https://freesound.org/s/861369/) | ChristopherJngs | Splashing Footsteps Shallow Water | 同上 |
| splash.m4a | 入池、出池、舀水 | 861369 | 同上 | 同上 | 取 4.3–6.9 秒 |
| pour.m4a | 淋水、鹿威し倒水 | [427392](https://freesound.org/s/427392/) | zembacraftworks | Pouring Water (Short) | 取前 1.9 秒 |
| gulp.m4a | 喝牛奶 | [397611](https://freesound.org/s/397611/) | swordofkings128 | Gulping | 取前 2 秒 |

## 格式約定

- 循環檔的內容是週期性的：前後各多放 0.25 秒的週期延伸，播放時設 `loopStart = 0.25`、`loopEnd = 0.25 + 週期`。這樣即使 AAC 解碼後整體偏移幾毫秒，接縫也不會有破音。週期寫在 `js/audio.js` 的 `LOOPS`。
- 循環檔的音量統一在 RMS −24 dBFS（鳥鳴較稀疏，改以峰值 −15 dBFS 對齊），各層的比例只在 `js/audio.js` 的 `MIX` 調。
- 腳步檔把每一步放進固定長度的格子，格長與格數寫在 `SLOTS`。
- 其餘的聲音（鹿威し敲石、開關燈、搖楓枝、瓶蓋、放回瓶子與木桶、石板上的腳步）是 `js/audio.js` 即時合成的，沒有檔案。

## 評估過但沒用的
- 蟲鳴：333221、522299（低頻雜音多）。鳥鳴：518668（同一位作者，較短）、563547（城市公園，有車聲）。
- 流水：411202（小瀑布，較急）、411213（小水流，較細）。風：575380、378725（風切聲重）。
- 木地板腳步：369641、740294。倒水：508178、173930。喝：320139、56270。
