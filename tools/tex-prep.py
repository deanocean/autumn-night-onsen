# 開發用：把 Poly Haven 下載的貼圖重新編碼成 textures/ 裡的檔案（解析度不變，只縮小檔案，讓線上版載入快一點）。
# 需要 Pillow（含 WebP 支援）。來源資料夾裡放 <slot>_diff.jpg／<slot>_nor.jpg／<slot>_rough.jpg（命名見 textures/README.md）。
# 用法：python3 tex-prep.py <來源資料夾> <輸出資料夾>
#
# 格式的選擇（8A 實測）：
#   - 顏色（diff）：WebP q90。比同大小的 JPG 誤差小。
#   - 粗糙度（rough）：WebP q85，灰階，誤差看不出來。
#   - 法線（nor）：JPG q88、不做色度抽樣（4:4:4）。WebP 一律把色度縮成一半，而法線的資訊全在顏色裡，
#     縮完角度誤差大一倍（岩石的法線最明顯），所以法線維持 JPG。
# 改了副檔名要同步改 js/shaders.js 的 TEX_EXT。
import os, sys
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
FMT = {
    'diff': ('webp', dict(format='WEBP', quality=90, method=6)),
    'rough': ('webp', dict(format='WEBP', quality=85, method=6)),
    'nor': ('jpg', dict(format='JPEG', quality=88, subsampling=0, optimize=True)),
}
total_in = total_out = 0
for name in sorted(os.listdir(SRC)):
    stem, ext = os.path.splitext(name)
    kind = stem.rsplit('_', 1)[-1]
    if ext.lower() not in ('.jpg', '.jpeg', '.png') or kind not in FMT:
        continue
    out_ext, kw = FMT[kind]
    im = Image.open(os.path.join(SRC, name))
    im = im.convert('L' if im.mode in ('L', 'I;16', 'I') and kind == 'rough' else 'RGB')
    dst = os.path.join(OUT, f'{stem}.{out_ext}')
    im.save(dst, **kw)
    a, b = os.path.getsize(os.path.join(SRC, name)), os.path.getsize(dst)
    if ext.lower() == '.' + out_ext and b >= a:  # 重存反而變大（原檔已經很小）就沿用原檔
        with open(os.path.join(SRC, name), 'rb') as f, open(dst, 'wb') as g:
            g.write(f.read())
        b = a
    total_in += a; total_out += b
    print(f'{name:22s} {a // 1024:6d} KB -> {os.path.basename(dst):22s} {b // 1024:6d} KB')
print(f'合計 {total_in / 2**20:.1f} MB -> {total_out / 2**20:.1f} MB')
