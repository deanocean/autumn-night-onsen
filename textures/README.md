# 貼圖來源（Poly Haven，CC0）

檔名規則：`<slot>_diff.webp`（顏色）、`<slot>_nor.jpg`（法線，OpenGL / nor_gl）、`<slot>_rough.webp`（粗糙度）。

從 Poly Haven 下載的 JPG 經 `tools/tex-prep.py` 重新編碼（解析度不變）：顏色 WebP q90、粗糙度 WebP q85、法線 JPG q88 不做色度抽樣（WebP 會把色度縮半，法線失真較大）。新增或更換貼圖時，把原檔照上面的檔名放進一個資料夾，執行 `python3 tools/tex-prep.py <來源> textures`；格式改了要同步改 `js/shaders.js` 的 `TEX_EXT`。

| slot | 素材 id | 素材頁 | 授權 | 解析度 | 實際涵蓋尺寸 | 木紋方向 |
|---|---|---|---|---|---|---|
| rock | rock_3 | https://polyhaven.com/a/rock_3 | CC0 | 2k | 1.5 m x 1.5 m | - |
| stone | rock_01 | https://polyhaven.com/a/rock_01 | CC0 | 2k | 1.5 m x 1.5 m | - |
| ground | gravel_floor_02 | https://polyhaven.com/a/gravel_floor_02 | CC0 | 2k | 2.0 m x 2.0 m | - |
| wood | fine_grained_wood | https://polyhaven.com/a/fine_grained_wood | CC0 | 2k | 0.6 m x 0.6 m | 垂直（V，沿圖片上下） |
| woodold | rough_wood | https://polyhaven.com/a/rough_wood | CC0 | 2k | 0.5 m x 0.5 m | 垂直（V，沿圖片上下） |
| plaster | beige_wall_001 | https://polyhaven.com/a/beige_wall_001 | CC0 | 1k | 3.0 m x 3.0 m | - |

涵蓋尺寸取自 Poly Haven API 的 dimensions 欄位（公釐換算成公尺）。

## 備選
- rock：seaside_rock（深灰、無裂紋、2.0 m）、rock_face_04（有裂紋但偏棕、含亮色碎屑、2.0 m）
- stone：granular_concrete（更均勻的灰、2.4 m）
- ground：gravel_floor_04（細、棕色、較平）
- wood：wood_table_001（1.5 m，直紋但有一處明顯木節圖案）
- woodold：weathered_planks / wood_planks_grey（有板縫）
- plaster：plastered_wall_03（4.0 m，灰褐有污斑）、patterned_clay_plaster（抹痕明顯、呈扇形重複）
