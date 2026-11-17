// 表面材質：在 Three.js 標準材質上「打補丁」，光照與陰影仍沿用內建計算。
// 近看的細節來自 textures/ 裡的實拍 PBR 貼圖（Poly Haven，CC0），以三向投影貼上，不需要 UV；
// 「哪裡長苔、哪裡濕、哪裡風化、木板接縫」這類分布仍由程序雜訊決定，疊在貼圖上。
// 屋頂（ROOF 杮葺、KAWARA 本瓦）、竹垣（BAMBOO）、池底（BASIN）維持純程序做法。
import * as THREE from 'three';
import { POOL } from './layout.js';
import { G } from './env.js';

export const GLSL_NOISE = /* glsl */ `
// 與 smoothstep 相同，但兩個邊界可以反過來寫（GLSL 內建版本在這種情況下行為未定義）
float rs(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float hash1(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash1(i), hash1(i + vec3(1,0,0)), f.x), mix(hash1(i + vec3(0,1,0)), hash1(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash1(i + vec3(0,0,1)), hash1(i + vec3(1,0,1)), f.x), mix(hash1(i + vec3(0,1,1)), hash1(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float fbm2(vec3 p){ return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + vec3(1.7, 9.2, 3.1)); }
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
// 回傳 (到最近點的距離, 到格線的距離, 該格的亂數)
vec3 voro(vec2 x){
  vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 r = g + hash2(n + g) - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash21(n + g); } else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}
`;

export const GLSL_POOL = /* glsl */ `
float poolRim(float th){ return 1.0 + 0.12 * sin(2.0 * th + 0.6) + 0.08 * sin(3.0 * th + 1.9) + 0.05 * sin(5.0 * th); }
float poolT(vec2 p){
  vec2 d = (p - vec2(${POOL.cx.toFixed(3)}, ${POOL.cz.toFixed(3)})) / vec2(${POOL.a.toFixed(3)}, ${POOL.b.toFixed(3)});
  return length(d) / poolRim(atan(d.y, d.x));
}
float poolDepth(vec2 p){
  float t = poolT(p);
  float floorY = -${POOL.depth.toFixed(3)} * rs(1.0, 0.78, t);
  return max(0.0, ${POOL.waterY.toFixed(3)} - floorY);
}
`;

// 每種表面提供兩個函式：surfH（凹凸高度，公尺）與 surfC（顏色倍率與粗糙度）
const MODES = {
  ROCK: /* glsl */ `
    float surfH(vec3 wp, vec3 op){
      // 只留大起伏；細部凹凸交給法線貼圖
      return fbm(wp * 2.4) * 0.05 + fbm2(wp * 9.0) * 0.01;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      float a = fbm(wp * 1.3);
      float lum = dot(gA, vec3(0.333)) / dot(uMean, vec3(0.333));
      c = mix(vec3(dot(gA, vec3(0.333))), gA, 0.3) * gMacro * ROCK_TINT;
      c *= mix(0.62, 1.12, a);
      // 礦物染色：局部偏赭
      c = mix(c, c * vec3(1.12, 0.98, 0.82), rs(0.55, 0.8, vnoise(wp * 2.3 + 11.0)) * 0.5);
      // 地衣：灰白與赭黃的小斑塊，邊緣跟著石面顆粒碎開
      float li = rs(0.60, 0.70, fbm(wp * 3.2 + 20.0) + (lum - 1.0) * 0.12) * rs(0.1, 0.5, n.y + 0.4);
      c = mix(c, mix(vec3(0.50, 0.52, 0.46), vec3(0.55, 0.46, 0.24), vnoise(wp * 2.0 + 8.0)) * (0.7 + 0.3 * lum), li * 0.45);
      float wet = rs(0.2, -0.06, wp.y + (a - 0.5) * 0.12);
      float moss = rs(0.45, 0.9, n.y) * rs(0.47, 0.60, fbm(wp * 1.6 + 7.0) + (lum - 1.0) * 0.10) * (1.0 - wet);
      vec3 mc = mix(vec3(0.060, 0.085, 0.025), vec3(0.125, 0.150, 0.045), vnoise(wp * 7.0)) * (0.5 + 1.0 * vnoise(wp * 110.0));
      c = mix(c, mc, moss * 0.9);
      c *= mix(1.0, 0.42, wet);
      r = mix(gR, 0.2, wet);
      r = mix(r, 1.0, moss);
    }`,
  GROUND: /* glsl */ `
    // 苔的分布（0–1）與一團團隆起的苔墊（杉苔、砂苔那種矮而密的墊狀，不是一根根的草）
    float mossMask(vec3 wp, float lum){ return rs(0.57, 0.66, fbm(wp * 0.55 + 3.0) + (1.0 - lum) * 0.10); }
    float mossPad(vec3 wp){
      vec2 q = wp.xz * 9.0 + (vec2(vnoise(wp * 3.0), vnoise(wp * 3.0 + 7.0)) - 0.5) * 1.2;
      return 1.0 - rs(0.0, 0.75, voro(q).x);
    }
    float surfH(vec3 wp, vec3 op){
      return fbm2(wp * 6.0) * 0.008 + mossMask(wp, 1.0) * (0.004 + mossPad(wp) * 0.014);
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      float a = fbm(wp * 2.2);
      float lum = dot(gA, vec3(0.333)) / dot(uMean, vec3(0.333));
      c = gA * gMacro * GROUND_TINT;
      c *= mix(0.8, 1.1, fbm2(wp * 0.6 + 4.0));
      // 苔：成片分布，邊緣沿著砂礫的縫隙滲開；顏色壓深、偏橄欖，墊與墊之間的縫較暗，
      // 表面只留很淡的絨毛顆粒（顆粒太亮太碎會像草皮）
      float moss = mossMask(wp, lum);
      float pad = mossPad(wp);
      vec3 mc = mix(vec3(0.030, 0.046, 0.016), vec3(0.070, 0.086, 0.028), vnoise(wp * 2.4 + 2.0));
      mc = mix(mc, vec3(0.085, 0.080, 0.030), rs(0.55, 0.8, vnoise(wp * 1.1 + 31.0)) * 0.6); // 局部偏黃褐
      mc *= mix(0.55, 1.15, pad) * (0.85 + 0.3 * vnoise(wp * 140.0));
      c = mix(c, mc, moss * 0.92);
      // 池邊被湯水打濕
      float t = poolT(wp.xz);
      float wet = rs(1.22, 1.02, t + (a - 0.5) * 0.1);
      c *= mix(1.0, 0.5, wet);
      r = mix(gR, 0.28, wet * (1.0 - moss * 0.6));
      r = mix(r, 1.0, moss * (1.0 - wet));
    }`,
  BASIN: /* glsl */ `
    float surfH(vec3 wp, vec3 op){
      vec3 v = voro(wp.xz * 1.25);
      return rs(0.0, 0.06, v.y) * 0.02 + fbm2(wp * 9.0) * 0.006;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec3 v = voro(wp.xz * 1.25);
      c = mix(vec3(0.46, 0.50, 0.47), vec3(0.74, 0.76, 0.70), v.z);
      c *= 0.82 + 0.3 * fbm2(wp * 5.0);
      c *= mix(0.4, 1.0, rs(0.0, 0.05, v.y));
      // 水底搖晃的光網
      vec2 q = wp.xz * 2.6 + vec2(vnoise(vec3(wp.xz * 1.3, uTime * 0.25)), vnoise(vec3(wp.zx * 1.3 + 5.0, uTime * 0.25))) * 1.6;
      float ca = voro(q + uTime * 0.12).y;
      c *= 1.0 + pow(1.0 - rs(0.0, 0.22, ca), 3.0) * 0.55 * uCaustic;
      r = 0.55;
    }`,
  STONE: /* glsl */ `
    float surfH(vec3 wp, vec3 op){ return fbm2(wp * 16.0) * 0.004; }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      c = clamp(gA / uMean, 0.2, 2.2) * 0.82;
      // 雨痕與積垢：朝上的面與凹處較深
      c = mix(c, c * vec3(0.55, 0.52, 0.48), rs(0.5, 0.75, fbm(wp * 2.0 + 4.0)));
      float lum = dot(gA, vec3(0.333)) / dot(uMean, vec3(0.333));
      float moss = rs(0.5, 0.64, fbm(wp * 3.0 + 9.0) + (1.0 - lum) * 0.1) * rs(-0.2, 0.7, n.y) * 0.7;
      c = mix(c, vec3(0.12, 0.15, 0.05) * (0.6 + 0.8 * vnoise(wp * 110.0)), moss);
      r = mix(gR, 1.0, moss);
    }`,
  WOOD: /* glsl */ `
    vec3 grainP(vec3 op){
      #if GRAIN == 0
        return op.xyz;
      #elif GRAIN == 1
        return op.yxz;
      #else
        return op.zyx;
      #endif
    }
    float plankSeam(vec3 q, out float id){
      #ifdef PLANK
        #ifdef PLANKY
          float u = q.y / PLANK + 0.5;
        #else
          float u = q.z / PLANK + 0.5;
        #endif
        id = hash21(vec2(floor(u), vSeed));
        return 1.0 - rs(0.004, 0.012, (0.5 - abs(fract(u) - 0.5)) * PLANK);
      #else
        id = 0.5; return 0.0;
      #endif
    }
    float surfH(vec3 wp, vec3 op){
      vec3 q = grainP(op); float id; float s = plankSeam(q, id);
      return -s * 0.012;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec3 q = grainP(op); float id; float s = plankSeam(q, id);
      // 貼圖只取「相對於平均色的變化」，木色由材質本身的顏色決定
      c = clamp(gA / uMean, 0.25, 2.4) * WOOD_GAIN * (0.82 + 0.36 * id);
      // 風化：偏灰、近地處較深
      float weather = fbm2(wp * 1.7 + 2.0);
      c = mix(c, vec3(dot(c, vec3(0.333))) * vec3(0.92, 0.95, 1.0), weather * WEATHER);
      c *= mix(0.72, 1.0, rs(0.0, 0.5, wp.y + weather * 0.3));
      c *= 1.0 - s * 0.75;
      r = clamp(gR + 0.05, 0.0, 1.0);
    }`,
  ROOF: /* glsl */ `
    // 杮葺：薄木片一排排疊上去。op.z 沿屋面斜向，op.x 沿屋脊方向
    vec3 shingle(vec3 op){
      float row = op.z / 0.2; float fr = fract(row); float ri = floor(row);
      float col = op.x / 0.13 + hash21(vec2(ri, 3.0)) ; float fc = fract(col);
      float id = hash21(vec2(floor(col), ri));
      return vec3(fr, fc, id);
    }
    float surfH(vec3 wp, vec3 op){
      vec3 s = shingle(op);
      return s.x * 0.012 + s.z * 0.004 - (1.0 - rs(0.0, 0.08, min(s.y, 1.0 - s.y))) * 0.006;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec3 s = shingle(op);
      c = mix(vec3(0.20, 0.17, 0.15), vec3(0.36, 0.31, 0.26), s.z);
      c *= 0.62 + 0.5 * s.x;
      c *= 0.5 + 0.5 * rs(0.0, 0.1, min(s.y, 1.0 - s.y));
      float moss = rs(0.5, 0.7, fbm(wp * 0.9 + 1.0));
      c = mix(c, vec3(0.19, 0.24, 0.10), moss * 0.6);
      vec3 v = voro(wp.xz * 7.0 + 2.0);
      float leaf = step(v.z, 0.22) * rs(0.3, 0.22, v.x) * step(0.0, n.y);
      c = mix(c, mix(vec3(0.60, 0.10, 0.04), vec3(0.85, 0.48, 0.08), fract(v.z * 31.0)), leaf);
      r = 0.95;
    }`,
  KAWARA: /* glsl */ `
    // 本瓦葺：平瓦與丸瓦一列隔一列。op.x 沿簷口方向、op.z 沿屋面往下（由頂點屬性 aTile 提供，見 world.js 的 tilePlane）
    const float KP = 0.27;  // 列距（公尺；world.js 的軒丸瓦用同一個數字）
    const float KR = 0.2;   // 丸瓦的半寬（相對於列距）
    // 回傳 (高度, 是否丸瓦, 該片的亂數, 平瓦上離丸瓦邊緣的距離 0..1)
    vec4 kawara(vec3 op){
      float col = op.x / KP, ci = floor(col), fx = abs(fract(col) - 0.5);
      float isR = step(fx, KR);
      float row = op.z / 0.3 + isR * 0.5 + hash21(vec2(ci, 5.0)) * 0.3;
      float fr = fract(row), id = hash21(vec2(ci + isR * 37.0, floor(row)));
      float t = clamp((fx - KR) / (0.5 - KR), 0.0, 1.0);
      float hr = 0.03 + 0.05 * sqrt(max(0.0, 1.0 - fx * fx / (KR * KR))) - 0.006 * (1.0 - rs(0.0, 0.07, min(fr, 1.0 - fr)));
      float hf = -0.016 * sin(t * 1.5708) + 0.012 * fr + id * 0.003;
      return vec4(mix(hf, hr, isR), isR, id, t);
    }
    float surfH(vec3 wp, vec3 op){ return kawara(op).x; }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec4 k = kawara(op);
      c = KAWARA_COL * (0.78 + 0.5 * k.z);
      // 丸瓦頂上受光，平瓦靠丸瓦的兩側在陰影裡（遠看凹凸淡掉後，條紋靠這個撐住）
      c *= mix(mix(0.5, 1.0, rs(0.0, 0.6, k.w)), 1.15, k.y);
      // 日曬雨淋的深淺、燻銀泛白的斑
      c *= 0.8 + 0.45 * fbm(wp * vec3(0.7, 1.4, 0.7) + 4.0);
      c = mix(c, vec3(0.30, 0.31, 0.32), rs(0.62, 0.8, fbm2(wp * 3.1 + 9.0)) * 0.35);
      float moss = rs(0.58, 0.75, fbm(wp * 0.9 + 1.0)) * (1.0 - k.y);
      c = mix(c, vec3(0.13, 0.17, 0.08), moss * 0.35);
      // 落在瓦溝裡的紅葉
      vec3 v = voro(wp.xz * 5.0 + 2.0);
      float leaf = step(v.z, 0.12) * rs(0.3, 0.22, v.x) * step(0.0, n.y) * (1.0 - k.y);
      c = mix(c, mix(vec3(0.60, 0.10, 0.04), vec3(0.85, 0.48, 0.08), fract(v.z * 31.0)), leaf);
      r = mix(0.42, 0.62, k.z);
    }`,
  BARK: /* glsl */ `
    // 樹皮：灰褐色、縱向的淺溝，朝上的面長苔，零星的地衣
    float surfH(vec3 wp, vec3 op){ return fbm2(wp * vec3(24.0, 3.0, 24.0)) * 0.006; }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      float lum = clamp(dot(gA, vec3(0.333)) / dot(uMean, vec3(0.333)), 0.35, 2.0);
      c = vec3(0.105, 0.088, 0.075) * lum;
      c *= 0.7 + 0.6 * fbm2(wp * vec3(10.0, 1.5, 10.0));
      float li = rs(0.56, 0.68, fbm(wp * 4.0 + 3.0));
      c = mix(c, vec3(0.26, 0.28, 0.23) * lum, li * 0.4);
      float moss = rs(0.0, 0.8, n.y) * rs(0.40, 0.58, fbm(wp * 2.2 + 5.0));
      c = mix(c, vec3(0.085, 0.115, 0.035) * (0.6 + 0.8 * vnoise(wp * 90.0)), moss * 0.85);
      r = mix(max(gR, 0.8), 1.0, moss);
    }`,
  PLASTER: /* glsl */ `
    float surfH(vec3 wp, vec3 op){ return fbm2(wp * 9.0) * 0.002; }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      c = clamp(gA / uMean, 0.5, 1.6);
      c *= 0.94 + 0.10 * fbm(wp * 3.0);
      // 雨水順牆流下留下的淡痕
      c *= mix(0.88, 1.0, rs(0.3, 0.7, fbm2(wp * vec3(0.9, 0.3, 0.9) + 5.0)));
      r = max(gR, 0.85);
    }`,
  BAMBOO: /* glsl */ `
    // 竹穗垣：細竹直排，上下以橫竹押住
    vec2 cane(vec3 wp){
      float u = (wp.x + wp.z) / 0.045; float id = hash21(vec2(floor(u), 7.0));
      float f = fract(u) * 2.0 - 1.0;
      return vec2(sqrt(max(0.0, 1.0 - f * f)), id);
    }
    float rail(vec3 wp){ float y = wp.y; return max(max(rs(0.05, 0.03, abs(y - 0.35)), rs(0.05, 0.03, abs(y - 1.05))), rs(0.05, 0.03, abs(y - 1.7))); }
    float surfH(vec3 wp, vec3 op){ return mix(cane(wp).x * 0.016, 0.03, rail(wp)); }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec2 k = cane(wp); float rl = rail(wp);
      c = mix(vec3(0.42, 0.33, 0.19), vec3(0.66, 0.55, 0.33), k.y);
      float node = rs(0.012, 0.0, abs(fract(wp.y / 0.42 + k.y) - 0.5) * 0.42);
      c *= (0.45 + 0.55 * k.x) * (1.0 - node * 0.35);
      c *= 0.8 + 0.3 * fbm2(wp * 1.5);
      c = mix(c, vec3(0.50, 0.42, 0.24) * (0.8 + 0.3 * vnoise(wp * vec3(3.0, 60.0, 3.0))), rl);
      c *= mix(0.72, 1.0, rs(0.0, 0.6, wp.y));
      r = 0.7;
    }`,
};

const BUMP_FN = /* glsl */ `
vec3 sBump(vec3 p, vec3 n, vec2 dH, float fd){
  vec3 sx = dFdx(p), sy = dFdy(p);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * n - grad);
}
`;

// ---------- 實拍貼圖 ----------
// size：一張貼圖在場景裡涵蓋的邊長（公尺）；grainV：木紋沿貼圖的垂直方向
export const TEXTURES = {
  rock: { size: 1.5 },
  stone: { size: 1.5 },
  ground: { size: 2.0 },
  wood: { size: 0.6, grainV: true },
  woodold: { size: 0.5, grainV: true },
  plaster: { size: 3.0 },
};
// 每種表面用哪一組貼圖、法線強度、是否加一層大尺度變化來打散重複感
const TEX_USE = {
  ROCK: { slot: 'rock', nstr: 1.3, macro: true },
  GROUND: { slot: 'ground', nstr: 1.2, macro: true },
  STONE: { slot: 'stone', nstr: 1.0 },
  WOOD: { slot: 'wood', nstr: 1.2, object: true },
  PLASTER: { slot: 'plaster', nstr: 0.7 },
  BARK: { slot: 'rock', nstr: 1.1 },
};
const TUNE = { ROCK_TINT: 'vec3(0.80, 0.82, 0.86)', GROUND_TINT: 'vec3(0.60, 0.56, 0.50)', WOOD_GAIN: '1.25', KAWARA_COL: 'vec3(0.105, 0.115, 0.135)' };

const loader = new THREE.TextureLoader();
// 每張貼圖一個 Promise（載入失敗也算結束）；main.js 的暖機會等它們全部到齊
const pendingTextures = [];
export const texturesReady = () => Promise.all(pendingTextures);
const texCache = new Map();
function texSet(slot) {
  if (texCache.has(slot)) return texCache.get(slot);
  const mean = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
  const load = (kind, srgb, onLoad) => {
    let done;
    pendingTextures.push(new Promise((r) => { done = r; }));
    const t = loader.load(`textures/${slot}_${kind}.jpg`, (tex) => { onLoad?.(tex); done(); }, undefined, () => done());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  const set = {
    mean,
    scale: { value: 1 / TEXTURES[slot].size },
    // 載入後量出整張圖的平均色（線性空間），shader 用它把貼圖換算成「相對變化」
    diff: { value: load('diff', true, (t) => {
      const n = 32, cv = document.createElement('canvas');
      cv.width = cv.height = n;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(t.image, 0, 0, n, n);
      const d = g.getImageData(0, 0, n, n).data, sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += Math.pow(d[i + k] / 255, 2.2);
      mean.value.set(sum[0], sum[1], sum[2]).multiplyScalar(1 / (n * n));
    }) },
    nor: { value: load('nor', false) },
    rough: { value: load('rough', false) },
  };
  texCache.set(slot, set);
  return set;
}

const TEX_FN = /* glsl */ `
uniform sampler2D tDiff, tNor, tRough; uniform vec3 uMean; uniform float uTS;
vec3 gP, gN, gW, gA; float gR, gMacro;
// 三個投影面的貼圖座標。木頭的 U 軸一律沿木紋（gP.x）
#ifdef TEX_GRAINV
  #define UVX(p) (p).zy
  #define UVY(p) (p).zx
  #define UVZ(p) (p).yx
#else
  #define UVX(p) (p).yz
  #define UVY(p) (p).xz
  #define UVZ(p) (p).xy
#endif
vec3 tri(sampler2D t, vec3 p){
  return texture2D(t, UVX(p)).rgb * gW.x + texture2D(t, UVY(p)).rgb * gW.y + texture2D(t, UVZ(p)).rgb * gW.z;
}
void texPrep(){
  #ifdef TEX_OBJ
    vec3 q = grainP(vOPos); float id; plankSeam(q, id);
    // 每片木板、每個物件各取貼圖的不同位置，避免相鄰的木紋一模一樣
    gP = (q + vec3(id * 3.71, id * 1.93, id * 2.37) + fract(vSeed * vec3(0.731, 0.417, 0.593)) * 5.0) * uTS;
    gN = normalize(grainP(vON));
  #else
    gP = vWPos * uTS;
    gN = normalize(vWN);
  #endif
  gW = pow(abs(gN), vec3(6.0)); gW /= gW.x + gW.y + gW.z;
  gA = tri(tDiff, gP);
  gR = tri(tRough, gP).g;
  gMacro = 1.0;
  #ifdef TEX_MACRO
    // 同一張貼圖放大七倍再讀一次，只取明暗，疊出大尺度的深淺變化
    vec3 m = tri(tDiff, gP * 0.137 + 0.31);
    gMacro = mix(1.0, dot(m, vec3(0.333)) / dot(uMean, vec3(0.333)), 0.55);
  #endif
}
// 三向投影的法線貼圖（whiteout 混合），回傳與 gN 同一空間的法線
vec3 triNormal(){
  vec3 a = texture2D(tNor, UVX(gP)).xyz * 2.0 - 1.0;
  vec3 b = texture2D(tNor, UVY(gP)).xyz * 2.0 - 1.0;
  vec3 c = texture2D(tNor, UVZ(gP)).xyz * 2.0 - 1.0;
  a.xy *= TEX_NSTR; b.xy *= TEX_NSTR; c.xy *= TEX_NSTR;
  #ifdef TEX_GRAINV
    a.xy = a.yx; b.xy = b.yx; c.xy = c.yx;
  #endif
  vec3 na = vec3(abs(a.z) * gN.x, a.x + gN.y, a.y + gN.z);
  vec3 nb = vec3(b.x + gN.x, abs(b.z) * gN.y, b.y + gN.z);
  vec3 nc = vec3(c.x + gN.x, c.y + gN.y, abs(c.z) * gN.z);
  return normalize(na * gW.x + nb * gW.y + nc * gW.z);
}
`;

// 把表面函式注入標準材質
export function patch(material, mode, defines = {}) {
  const defs = { GRAIN: 0, WEATHER: '0.45', ...TUNE, ...defines };
  const use = TEX_USE[mode];
  let tex = null;
  if (use) {
    // 木頭：樑柱、地板等一般木料用紋理清楚的風化木；牆板與檜木小物（weather 低）用細緻的那一組
    const slot = mode === 'WOOD' && !(defs.PLANKY || Number(defs.WEATHER) <= 0.25) ? 'woodold' : use.slot;
    tex = texSet(slot);
    defs.USE_TEX = 1;
    defs.TEX_NSTR = use.nstr.toFixed(2);
    if (use.object) defs.TEX_OBJ = 1;
    if (use.macro) defs.TEX_MACRO = 1;
    if (TEXTURES[slot].grainV) defs.TEX_GRAINV = 1;
  }
  const defStr = Object.entries(defs).map(([k, v]) => `#define ${k} ${v}`).join('\n');
  material.customProgramCacheKey = () => mode + defStr;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.uniforms.uCaustic = G.caustic;
    if (tex) {
      shader.uniforms.tDiff = tex.diff;
      shader.uniforms.tNor = tex.nor;
      shader.uniforms.tRough = tex.rough;
      shader.uniforms.uMean = tex.mean;
      shader.uniforms.uTS = tex.scale;
    }
    const VARY = 'varying vec3 vWPos; varying vec3 vOPos; varying vec3 vWN; varying vec3 vON; varying mat3 vM3; varying float vSeed;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${VARY}${defs.TILE_ATTR ? '\nattribute vec3 aTile;' : ''}`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vWN = inverseTransformDirection(transformedNormal, viewMatrix);
        vON = objectNormal;
        vM3 = mat3(modelMatrix);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vOPos = ${defs.TILE_ATTR ? 'aTile' : 'transformed'};
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSeed = dot(modelMatrix[3].xyz, vec3(1.31, 2.17, 3.73));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${defStr}
        ${VARY}
        uniform float uTime; uniform float uCaustic;
        ${GLSL_NOISE}
        ${GLSL_POOL}
        ${tex ? TEX_FN.split('void texPrep()')[0] : ''}
        ${MODES[mode]}
        ${tex ? 'void texPrep()' + TEX_FN.split('void texPrep()')[1] : ''}
        ${BUMP_FN}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_TEX
          texPrep();
        #endif
        vec3 sC; float sR;
        surfC(vWPos, vOPos, normalize(vWN), sC, sR);
        diffuseColor.rgb *= sC;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = sR;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_TEX
        {
          vec3 tn = triNormal();
          #ifdef TEX_OBJ
            tn = normalize(vM3 * grainP(tn));
          #endif
          normal = normalize(mat3(viewMatrix) * tn);
        }
        #endif
        {
          float bFade = 1.0 - rs(10.0, 34.0, length(vViewPosition));
          if (bFade > 0.0) {
            vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos), dox = dFdx(vOPos), doy = dFdy(vOPos);
            float h0 = surfH(vWPos, vOPos);
            float hx = surfH(vWPos + dpx, vOPos + dox);
            float hy = surfH(vWPos + dpy, vOPos + doy);
            normal = sBump(-vViewPosition, normal, vec2(hx - h0, hy - h0) * bFade, faceDirection);
          }
        }`);
  };
  return material;
}
