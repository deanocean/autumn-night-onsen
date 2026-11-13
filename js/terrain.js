// 地形的高度函式：溫泉所在的山頂平台、往北落進海灣的山坡、灣裡的半島與小島、對岸與更遠的山。
// 參考舞鶴的眺望台往下看的リアス式海灣：溫泉約在海面上方 220 公尺。
// 純數學、不依賴 three，node 也能載入（用來出鳥瞰圖檢查）。座標同 layout.js：x 向東、z 向南、y 向上。
export const SEA = -220;   // 海面高度
const BED = -300;          // 海底（實際上看不到，只用來讓海岸線有坡度）

// 溫泉所在的山頂平台（場內地面與場外樹林都在這裡，高度 -0.05，比場內地面低一點避免重疊閃爍）
export const PLATEAU = { x0: -34, x1: 34, z0: -13, z1: 40, y: -0.05 };

// ---------- 雜訊 ----------
// 查表式的梯度雜訊（不用三角函式，整張地形約 20 萬點要在開場時算完）
const PERM = new Uint8Array(512), GX = new Float32Array(256), GY = new Float32Array(256);
{
  let seed = 1234567;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const X = ix & 255, Y = iy & 255;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const g00 = PERM[PERM[X] + Y], g10 = PERM[PERM[X + 1] + Y], g01 = PERM[PERM[X] + Y + 1], g11 = PERM[PERM[X + 1] + Y + 1];
  const a = GX[g00] * fx + GY[g00] * fy, b = GX[g10] * (fx - 1) + GY[g10] * fy;
  const c = GX[g01] * fx + GY[g01] * (fy - 1), d = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  return 0.5 + 0.7 * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
}
export function fbm2(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); f *= 2.03; a *= 0.5;
    const t = x; x = x * 0.8 - y * 0.6; y = t * 0.6 + y * 0.8; // 每層轉個角度，避免方格感
  }
  return s / (1 - Math.pow(0.5, oct));
}
// 稜線狀的雜訊：尖的山脊、圓的谷
function ridged(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x * f + i * 5.7, y * f + i * 3.1) * 2 - 1);
    n *= n * w; w = Math.min(1, n * 1.6);
    s += a * n; f *= 2.1; a *= 0.5;
    const t = x; x = x * 0.8 - y * 0.6; y = t * 0.6 + y * 0.8;
  }
  return s;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

// ---------- 水域：海灣由幾個形狀聯集而成，陸地是其餘部分 ----------
// [ax, az, bx, bz, ra, rb]：從 a 到 b 的膠囊，半徑由 ra 漸變到 rb
const WATERS = [
  [-700, -760, 700, -760, 520, 520],        // 眼前的內灣
  [0, -1500, 0, -4400, 2100, 2000],         // 主灣
  [-1200, -1100, -4600, -1500, 420, 300],   // 左手邊的支灣（港）
  [1100, -700, 4200, -420, 330, 240],       // 右手邊的支灣
  [0, -4600, 0, -16000, 1100, 4200],         // 通往外海的水道，越遠越寬
  [-2000, -3300, -5600, -3000, 420, 300],   // 對岸左側的小灣
  [2100, -3100, 6000, -2700, 400, 260],     // 對岸右側的小灣
];
function capsule(x, z, [ax, az, bx, bz, ra, rb]) {
  const ex = bx - ax, ez = bz - az;
  const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
  return Math.hypot(x - ax - ex * t, z - az - ez * t) - (ra + (rb - ra) * t);
}
// 到海岸的距離：陸上為正、海裡為負。座標先扭過，海岸線才會曲折（リアス式）
function coastDist(x, z) {
  const wx = x + (fbm2(x / 700, z / 700, 3) - 0.5) * 520 + (fbm2(x / 170 + 3, z / 170, 2) - 0.5) * 110;
  const wz = z + (fbm2(x / 700 + 7.7, z / 700 - 3.1, 3) - 0.5) * 520 + (fbm2(x / 170, z / 170 + 5, 2) - 0.5) * 110;
  let d = 1e9;
  for (const w of WATERS) d = Math.min(d, capsule(wx, wz, w));
  return d;
}

// ---------- 山脊：一串 [x, z, 稜線高度]，往兩側以 s 的坡度落下，c 是稜線的圓潤程度 ----------
// 由近而遠；最後一點通常在海面下，形成伸進海裡的岬角
const RIDGES = [
  // 溫泉這座山往東北、西北伸出的兩條支稜，框住前景
  { s: 0.8, c: 30, p: [[-75, -40, -32], [-180, -160, -80], [-380, -420, -160], [-560, -640, -236]] },
  { s: 0.8, c: 30, p: [[75, -40, -32], [200, -130, -75], [420, -320, -150], [620, -560, -236]] },
  // 左手邊的大山（伸進灣裡的半島）
  { s: 0.62, c: 120, p: [[-4200, -400, 110], [-2900, -900, 120], [-2000, -1350, 70], [-1300, -1650, -60], [-850, -1850, -236]] },
  // 右手邊的半島
  { s: 0.65, c: 100, p: [[4200, -150, 140], [2800, -600, 90], [1900, -950, 20], [1300, -1180, -110], [950, -1300, -236]] },
  // 對岸：左右兩道山脈，中間留出通往外海的水道
  { s: 0.5, c: 200, p: [[-9000, -3600, 280], [-6000, -4400, 240], [-3700, -4900, 160], [-2200, -5300, 20], [-1400, -5600, -236]] },
  { s: 0.5, c: 200, p: [[9000, -3100, 320], [6000, -3900, 270], [3900, -4500, 200], [2300, -5000, 60], [1300, -5300, -236]] },
  // 最遠一層（只剩淡淡的輪廓）
  { s: 0.3, c: 300, p: [[-11000, -7000, 420], [-6000, -8300, 330], [-3200, -9400, 180], [-2200, -10200, -236]] },
  { s: 0.3, c: 300, p: [[11000, -6200, 450], [6000, -7700, 350], [3200, -9100, 200], [2000, -10000, -236]] },
];
// 小島：[x, z, 半徑, 頂高, 長寬比, 方向]
const ISLANDS = [
  [170, -1380, 120, -160, 1.6, 0.4], [-130, -1960, 80, -182, 1.2, 1.1], [540, -2180, 170, -128, 1.9, -0.3],
  [-470, -2560, 55, -198, 1.0, 0], [260, -2800, 70, -190, 1.4, 0.8], [1350, -1700, 60, -195, 1.3, 0.2],
];

function ridgeHeight(x, z, R) {
  let best = -1e9;
  const p = R.p;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az, ah] = p[i], [bx, bz, bh] = p[i + 1];
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / L2, 0, 1);
    const dx = x - ax - ex * t, dz = z - az - ez * t;
    const d = Math.sqrt(dx * dx + dz * dz);
    const h = ah + (bh - ah) * t - R.s * (Math.sqrt(d * d + R.c * R.c) - R.c);
    if (h > best) best = h;
  }
  return best;
}

function homeHeight(x, z) {
  const P = PLATEAU;
  const dx = x - clamp(x, P.x0, P.x1), dz = z - clamp(z, P.z0, P.z1);
  const d = Math.hypot(dx, dz);
  if (d === 0) return P.y;
  // 北面陡（崖邊就是望景台），東西兩側緩，南側更緩（接上湯屋後方的稜線）
  const ax = Math.abs(dx), nf = dz < 0 ? -dz / (ax - dz) : 0, sf = dz > 0 ? dz / (ax + dz) : 0;
  const k = 330 + (165 - 330) * nf + (900 - 330) * sf;
  let h = P.y - (P.y - BED) * (1 - Math.exp(-d / k));
  // 湯屋後方（南側）的稜線
  h += 40 * sstep(40, 85, z) * (1 - sstep(150, 240, z)) * (1 - sstep(220, 520, Math.abs(x))) * (0.7 + 0.6 * fbm2(x / 90, z / 90, 3));
  return h;
}

// 未整地的高度（聚落的平地另外壓）
function rawHeight(x, z) {
  const P = PLATEAU;
  if (x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1) {
    // 場內地面（world.js，x ±16、z -12.6..22）底下壓低，池盆的洞才看得到水；邊緣藏在地面板下面
    const e = Math.min(x + 15.6, 15.6 - x, z + 12.2, 21.6 - z);
    return e > 0 ? P.y - Math.min(1, e / 0.4) * 1.2 : P.y;
  }
  const r = Math.hypot(x, z);
  // 遠處的地形扭一扭，山脊才不會是直的
  const ww = sstep(200, 900, r);
  const wx = x + ww * (fbm2(x / 900, z / 900, 3) - 0.5) * 520;
  const wz = z + ww * (fbm2(x / 900 + 7.7, z / 900 - 3.1, 3) - 0.5) * 520;
  // 陸地的底：離海岸越遠越高（到 120 公尺左右持平），海裡往下
  const D = coastDist(x, z);
  let h = D > 0 ? SEA + (1 - Math.exp(-D / 200)) * 125 : SEA + D * 0.6;
  // 柔和的 max 會在兩者相近處往上鼓出最多 k/4；崖邊附近要很小，否則平台邊緣會鼓起一道土堤
  const k = 2 + 58 * sstep(60, 600, r);
  h = smax(h, homeHeight(x, z), k);
  for (const R of RIDGES) h = smax(h, ridgeHeight(wx, wz, R), k);
  for (const [ix, iz, ir, ih, asp, ang] of ISLANDS) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const u = ((wx - ix) * c + (wz - iz) * s) / asp, v = -(wx - ix) * s + (wz - iz) * c;
    const d = Math.hypot(u, v);
    h = smax(h, ih - (ih - BED) * Math.pow(Math.min(1, d / (ir * 2.2)), 1.4), 30);
  }
  h = Math.max(h, BED);
  // 網格邊緣（約 12 公里）之外沒有地形：最外圈壓回海面以下，接上天空的地平線
  h += (SEA - 8 - h) * sstep(11000, 12300, r);
  // 細節：大起伏、稜線狀的谷與脊、小凹凸。越接近平台越弱（崖邊保持乾淨）
  const near = sstep(4, 60, Math.hypot(x - clamp(x, P.x0, P.x1), z - clamp(z, P.z0, P.z1)));
  // 海裡不加（否則淺灘會冒出小島、把海灣吃掉）
  const amp = sstep(SEA - 15, SEA + 70, h) * near;
  h += amp * ((fbm2(x / 380, z / 380, 4) - 0.5) * 90 + (ridged(x / 210, z / 210, 4) - 0.35) * 55 + (fbm2(x / 55, z / 55, 3) - 0.5) * 10);
  return h;
}

// ---------- 聚落（白天是屋頂的灰白點、夜晚是燈火） ----------
// 先給大概的位置 [x, z, 半徑, 密度]，載入時各自找最近的海岸點當中心；
// 聚落範圍內的陸地被壓成貼著海岸的緩坡（只壓低陸地，海岸線不動），燈與屋頂才放得下
const TOWN_HINTS = [
  [1100, -450, 400, 1.0],   // 右前方、右手邊支灣口的大聚落
  [-1150, -850, 340, 0.85], // 左手邊大山腳下的港
  [-650, -300, 240, 0.7],   // 左前方的小漁港
  [-2300, -3300, 400, 0.7], // 對岸左
  [2200, -3150, 440, 0.8],  // 對岸右
  [700, -4500, 280, 0.5],   // 水道口右
  [-1400, -4900, 260, 0.5], // 水道口左
  [2000, -900, 280, 0.6],   // 右手邊半島的內灣
  [-2400, -1300, 280, 0.6], // 左手邊支灣深處
];
export const TOWNS = TOWN_HINTS.map(([hx, hz, r, d]) => {
  let best = null, bd = 1e9;
  for (let dz = -700; dz <= 700; dz += 25) for (let dx = -700; dx <= 700; dx += 25) {
    const x = hx + dx, z = hz + dz, h = rawHeight(x, z);
    if (Math.abs(h - SEA - 4) > 3) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = [x, z]; }
  }
  if (!best) return [hx, hz, r, d];
  // 從海岸點往上坡方向移半個半徑，聚落大半落在陸上
  const [x, z] = best, h = rawHeight(x, z);
  let gx = rawHeight(x + 20, z) - h, gz = rawHeight(x, z + 20) - h;
  const gl = Math.hypot(gx, gz) || 1;
  return [x + (gx / gl) * r * 0.5, z + (gz / gl) * r * 0.5, r, d];
});

// 主函式：任一點的地面高度（低於 SEA 的地方是海）
export function heightAt(x, z) {
  let h = rawHeight(x, z);
  if (h <= SEA) return h;
  for (const [tx, tz, tr] of TOWNS) {
    const w = sstep(tr * 1.15, tr * 0.45, Math.hypot(x - tx, z - tz));
    if (w > 0) h += (SEA + 1.5 + (h - SEA) * 0.12 - h) * w;
  }
  return h;
}
