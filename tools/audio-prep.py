# 開發用：把 Freesound 下載的原始錄音處理成 audio/ 裡的檔案（濾波、裁切、無縫循環、切腳步、正規化、轉 AAC）。
# 需要 numpy 與 macOS 的 afconvert。來源檔先轉成 44.1 kHz 16-bit WAV 放在執行目錄的 audio/ 下：
#   <id>.wav 是單聲道（afconvert -f WAVE -d LEI16@44100 -c 1），<id>_st.wav 是立體聲；id 對照見 audio/README.md。
# 用法：python3 audio-prep.py <輸出資料夾>
import wave, numpy as np, subprocess, os, sys
SR = 44100
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True); os.makedirs('audio/out', exist_ok=True)
def load(p):
    w = wave.open(p); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    assert w.getframerate() == SR
    return x.reshape(-1, w.getnchannels())
def filt(x, lo=0, hi=22050, soft=1.3):
    # 頻域的平滑高通／低通
    X = np.fft.rfft(x, axis=0); f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if lo: g *= np.clip(np.log(np.maximum(f, 1) / (lo / soft)) / np.log(soft * soft), 0, 1)
    if hi < 22050: g *= np.clip(np.log((hi * soft) / np.maximum(f, 1)) / np.log(soft * soft), 0, 1)
    return np.fft.irfft(X * g[:, None], n=len(x), axis=0).astype(np.float32)
rms = lambda x: float(np.sqrt(np.mean(x ** 2)))
db = lambda v: 20 * np.log10(max(v, 1e-9))
def soft(x, knee=0.5):
    a = np.abs(x); over = a > knee
    y = x.copy(); y[over] = np.sign(x[over]) * (knee + (0.92 - knee) * np.tanh((a[over] - knee) / (0.92 - knee)))
    return y
def save(name, x, kbps):
    x = soft(x)
    w = wave.open(f'audio/out/{name}.wav', 'w'); w.setnchannels(x.shape[1]); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((x * 32767).astype(np.int16).tobytes()); w.close()
    dst = f'{OUT}/{name}.m4a'
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(kbps * 1000), '-q', '127', f'audio/out/{name}.wav', dst], check=True)
    print(f'{name:12} {len(x)/SR:6.2f}s {x.shape[1]}ch rms {db(rms(x)):6.1f} peak {db(np.abs(x).max()):6.1f} {os.path.getsize(dst)//1024:5}KB')
PAD = 0.25
def loop(x, start, P, X=3.0, target=-24, peak=None):
    # 週期 P 秒的無縫循環：開頭 X 秒與 P 之後的 X 秒交叉淡化；前後各多放 PAD 秒的週期延伸
    s, n, k = int(start * SR), int(P * SR), int(X * SR)
    seg = x[s:s + n + k].copy()
    t = np.linspace(0, np.pi / 2, k)[:, None]
    body = seg[:n].copy()
    body[:k] = seg[:k] * np.sin(t) + seg[n:n + k] * np.cos(t)
    # peak：改用峰值對齊（稀疏的聲音用 RMS 對齊會被放得太大）
    body *= 10 ** (peak / 20) / np.percentile(np.abs(body), 99.9) if peak is not None else 10 ** (target / 20) / rms(body)
    p = int(PAD * SR)
    return np.concatenate([body[-p:], body, body[:p]])
def sparse(x, pct=72, floor_db=-20, power=2.0):
    # 向下擴展：只留突出的聲音，其餘壓到 floor_db。門檻取包絡的第 pct 百分位
    w = SR // 100
    a = np.abs(x).max(1)
    e = np.array([a[i:i + w].max() for i in range(0, len(a), w)])
    env = np.zeros_like(e); v = 0.0
    for i, t in enumerate(e):  # 快起慢落（落下約 0.25 秒）
        v = t if t > v else v * 0.96
        env[i] = v
    env = np.maximum(env, np.roll(env, -3))  # 提前 30 ms 打開，不切掉叫聲的開頭
    thr = np.percentile(env, pct)
    g = np.clip(env / thr, 0, 1) ** power
    g = np.maximum(g, 10 ** (floor_db / 20))
    g = np.interp(np.arange(len(a)), np.arange(len(e)) * w + w / 2, g)
    return x * g[:, None].astype(np.float32)
def onsets(m, lo, hi, gap, thr_db):
    w = SR // 100
    e = np.array([np.sqrt(np.mean(m[i:i + w] ** 2)) for i in range(0, len(m) - w, w)])
    thr = 10 ** (thr_db / 20) * e.max()
    out, last = [], -1e9
    for i in range(1, len(e)):
        t = i * w / SR
        if lo <= t < hi and e[i] > thr and e[i - 1] <= thr and t - last >= gap:
            out.append(t); last = t
    return out
def slots(m, ts, length, slot, lead=0.02, target_peak=-4):
    k = int(slot * SR); out = np.zeros((len(ts) * k, 1), np.float32)
    for i, t in enumerate(ts):
        a = int((t - lead) * SR); c = m[max(a, 0):max(a, 0) + int(length * SR)].copy()
        f = int(0.006 * SR); c[:f] *= np.linspace(0, 1, f)
        g = int(length * SR * 0.45); c[-g:] *= np.linspace(1, 0, g) ** 1.5
        c *= 10 ** (target_peak / 20) / np.percentile(np.abs(c), 99.7)
        out[i * k:i * k + len(c), 0] = c
    return out
def shot(m, a, b, fade_out, target_peak=-3, fade_in=0.008):
    c = m[int(a * SR):int(b * SR)].copy()
    f = int(fade_in * SR); c[:f] *= np.linspace(0, 1, f)
    g = int(fade_out * SR); c[-g:] *= np.linspace(1, 0, g) ** 1.5
    return (c * 10 ** (target_peak / 20) / np.percentile(np.abs(c), 99.8))[:, None]

# ---- 環境聲（循環） ----
x = load('audio/236981_st.wav').mean(1, keepdims=True)
save('stream', loop(filt(x, lo=120), 2, 45), 96)
# 只留清脆的高音鳥鳴：濾掉 3 kHz 以下那群密集的鳥，再把不突出的叫聲壓下去
b = sparse(filt(load('audio/518671_st.wav'), lo=3000, soft=1.2))
save('birds', loop(b, 26, 52, X=4, peak=-15), 112)
c = filt(load('audio/175020_st.wav'), lo=1200)
c2 = filt(load('audio/530477_st.wav'), lo=1500)
n = int(52 * SR); s2 = int(8 * SR)
c = c[int(2 * SR):int(2 * SR) + n]
near = c2[s2:s2 + n] * (rms(c) / rms(c2[s2:s2 + n])) * 0.4
c = c + near * np.array([[1.0, 0.45]])
save('crickets', loop(c, 0, 45, X=4), 112)
w = filt(load('audio/751473_st.wav'), lo=180)
save('wind', loop(w, 82, 46, X=5), 96)

# ---- 腳步（每 SLOT 秒一格） ----
m = load('audio/403600.wav')[:, 0]
ts = onsets(m, 0, 4.8, 0.3, -26); print('wood onsets', [round(t, 2) for t in ts])
save('step_wood', slots(filt(m[:, None], lo=40)[:, 0], ts, 0.34, 0.4, target_peak=-8), 80)
m = filt(load('audio/861369.wav'), lo=90)[:, 0]
ts = onsets(m, 0, 8.2, 0.5, -11); print('wade onsets', [round(t, 2) for t in ts])
save('step_wade', slots(m, ts, 0.62, 0.7, lead=0.03, target_peak=-8), 96)

# ---- 單發 ----
m = load('audio/427392.wav')[:, 0]
save('pour', shot(m, 0.0, 1.9, 0.7), 96)
m = load('audio/861369.wav')[:, 0]
save('splash', shot(filt(m[:, None], lo=70)[:, 0], 4.3, 6.9, 1.2, target_peak=-8), 96)
m = load('audio/397611.wav')[:, 0]
save('gulp', shot(m, 0.0, 2.05, 0.15, target_peak=-10), 80)
