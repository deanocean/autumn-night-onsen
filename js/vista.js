// 遠景：從溫泉的崖邊往北看下去的海灣。地形高度在 terrain.js；這裡把它蓋成網格、上色、點燈。
// - 網格是以原點為中心的極座標格子：近處密、遠處疏，一路延伸到 46 公里外（外海與海平線上的島）。
// - 陸地、海面、聚落都在同一個 shader 裡：低於海面的頂點壓平成海面，片段依「原始高度」判斷是水是陸，
//   海岸線因此沒有兩層網格交疊的閃爍。
// - 陸地：遠看是一顆顆樹冠的明暗（Voronoi 格子當樹冠），紅、橙、黃與杉綠依區塊混色；越遠越模糊成平均色。
// - 海面：反射天色（越斜看越亮）；對岸的山在海面上的倒影由 JS 預先沿視線方向算好（aRefl）。
// - 夜晚：聚落與沿岸道路的燈火（Points），近水的燈在海面拉出倒影光條。
import * as THREE from 'three';
import { G } from './env.js';
import { GLSL_NOISE } from './shaders.js';
import { SEA, heightAt, TOWNS, PLATEAU, R_MAX, sstep } from './terrain.js';

const NA = 720; // 一圈的格數
const EYE_Y = 1.85;

function ringRadii() {
  const r = [0];
  let x = 2;
  while (x < 44) { r.push(x); x += 1.2; }
  while (x < R_MAX) { r.push(x); x *= x < 9000 ? 1.021 : 1.016; } // 遠山的稜線取樣密一點，剪影才不會缺角
  r.push(R_MAX);
  return r;
}

// ---------- shader ----------
const vert = /* glsl */ `
attribute float aH;
attribute float aRefl;
varying vec3 vW; varying float vH; varying vec3 vN; varying float vRefl;
void main(){
  vW = position; vH = aH; vN = normal; vRefl = aRefl;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

// 雲影與空氣遠近：地形與房子共用，兩者才會一起變淡、一起落在同一片雲影裡
const GLSL_AIR = /* glsl */ `
float cloudShade(vec3 P, float dist){
  float cs = fbm(vec3(P.xz / 2600.0 + vec2(uTime * 0.004, 0.0), 12.0));
  return mix(1.0, 0.42 + 0.58 * rs(0.38, 0.6, cs), rs(250.0, 1200.0, dist));
}
vec3 applyAir(vec3 col, vec3 P, float dist, float water){
  float dens = (1.0 / uAir) * (1.0 + 0.35 * exp(-max(P.y - SEA, 0.0) / 90.0));
  float hz = 1.0 - exp(-dist * dens);
  // 中距離的靄偏藍（天空的散射光），越遠越接近地平線的顏色；海平線留一線比天空深一點的藍
  vec3 hcol = mix(mix(uHaze, uSkyTop, 0.5 * (1.0 - uNight)), uSkyHorizon, 0.6 * rs(6000.0, 36000.0, dist));
  // 海面不會褪成天空的顏色：遠處仍是比天空深的藍，海平線才看得出來
  hcol = mix(hcol, mix(uHaze, uSkyTop, 0.62) * mix(0.9, 1.0, uNight), water);
  hz = min(hz, mix(0.97, 0.9, water));
  col = mix(col, hcol, hz);

  return col;
}`;

const frag = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uHemiSky, uHemiGround, uHaze, uSkyTop, uSkyHorizon;
uniform float uSunI, uHemiI, uNight, uTime, uLit, uAir;
uniform vec4 uTowns[${TOWNS.length}];
varying vec3 vW; varying float vH; varying vec3 vN; varying float vRefl;
${GLSL_NOISE}
const float SEA = ${SEA.toFixed(1)};
const float PI = 3.14159265;

// 樹冠的顏色：闊葉（紅、橙、黃、褐、殘綠）與杉、檜（深綠）
vec3 broadCol(float h){
  h = fract(h);
  if (h < 0.10) return vec3(0.40, 0.07, 0.04);
  if (h < 0.22) return vec3(0.52, 0.17, 0.05);
  if (h < 0.34) return vec3(0.56, 0.30, 0.07);
  if (h < 0.44) return vec3(0.52, 0.40, 0.10);
  if (h < 0.62) return vec3(0.24, 0.17, 0.08);
  if (h < 0.80) return vec3(0.22, 0.23, 0.08);
  return vec3(0.13, 0.19, 0.07);
}
vec3 conCol(float h){ return mix(vec3(0.035, 0.085, 0.045), vec3(0.08, 0.14, 0.07), h); }
const vec3 CON_AVG = vec3(0.055, 0.11, 0.058);
// 水邊：岩岸的高度（公尺）與顏色、淺水的深度（公尺）與顏色
const float SHORE_H = 1.6, SHALLOW_D = 5.0;
const vec3 SHORE_COL = vec3(0.27, 0.25, 0.21), SHALLOW_COL = vec3(0.05, 0.135, 0.15);

float townMask(vec2 p){
  float m = 0.0;
  for (int i = 0; i < ${TOWNS.length}; i++) {
    vec4 t = uTowns[i];
    m = max(m, rs(t.z, t.z * 0.35, length(p - t.xy)) * t.w);
  }
  return m;
}

${GLSL_AIR}
vec3 skyAt(vec3 d){ return mix(uSkyHorizon, uSkyTop, pow(clamp(d.y, 0.0, 1.0), 0.5)); }

void main(){
  vec3 P = vW;
  vec3 toC = cameraPosition - P; float dist = length(toC); vec3 V = toC / dist;
  vec3 N = normalize(vN);
  vec3 L = normalize(uSunDir);
  float px = max(length(vec2(length(dFdx(P.xz)), length(dFdy(P.xz)))), 0.002); // 一個像素大約幾公尺
  float h = vH - SEA; // 離海面的高度

  // 海岸線加一點細碎的曲折（遠處淡掉）
  float hc = h + (fbm2(vec3(P.xz / 9.0, 1.0)) - 0.35) * 2.5 * rs(4.0, 1.0, px);
  float water = clamp(-hc / max(fwidth(hc), 0.03) + 0.5, 0.0, 1.0);

  // ---------- 陸地 ----------
  float zone = fbm(vec3(P.xz / 480.0, 3.0));
  // 杉、檜的人工林成片出現，背陽的北坡多一些
  float conifer = clamp(rs(0.36, 0.56, zone) * 0.75 + 0.12 - N.z * 0.25, 0.04, 0.96);
  float hueZone = fbm2(vec3(P.xz / 160.0, 8.0));

  // 遠看的起伏：網格的頂點間隔在遠處有幾十公尺，小谷小脊靠法線的擾動補上
  float be = max(px * 1.5, 10.0);
  vec3 bp = vec3(P.xz / 130.0, 6.0);
  float b0 = fbm(bp);
  vec2 bg = vec2(fbm(bp + vec3(be / 130.0, 0.0, 0.0)) - b0, fbm(bp + vec3(0.0, be / 130.0, 0.0)) - b0) / be;
  vec3 Nb = normalize(N - vec3(bg.x, 0.0, bg.y) * 38.0 * rs(140.0, 30.0, px) * rs(-2.0, 12.0, h));

  // 樹冠：Voronoi 格子，每格一棵樹，以到中心的向量做出圓頂的法線。座標先扭一扭，樹才有大有小、不排成格子
  const float CS = 6.5;
  vec2 qw = P.xz + (vec2(vnoise(vec3(P.xz / 21.0, 1.0)), vnoise(vec3(P.xz / 21.0, 7.0))) - 0.5) * 9.0;
  vec2 q = qw / CS, n = floor(q), f = fract(q);
  float md = 8.0, md2 = 8.0; vec2 mr = vec2(0.0), mc = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash2(n + g) * 0.8 + 0.1 - f;
    float d = dot(r, r);
    if (d < md) { md2 = md; md = d; mr = r; mc = g; } else if (d < md2) md2 = d;
  }
  vec2 cell = n + mc;
  float id = hash21(cell), id2 = fract(id * 37.13), id3 = fract(id * 91.7);
  float isCon = step(id2, conifer);
  // 樹冠的輪廓與表面：一叢叢葉子的凹凸（近看才有）
  float lump = fbm2(vec3(P.xz / 1.1, P.y / 1.1)), fine = vnoise(vec3(P.xz / 0.28, P.y / 0.28));
  float nearK = rs(0.35, 0.06, px);
  float rad = 0.62 + 0.22 * id3;
  float dd = sqrt(md) / rad + (lump - 0.4) * 0.5 * nearK;
  float t = clamp(dd, 0.0, 1.0);
  float edge = sqrt(md2) - sqrt(md);
  float gap = clamp(rs(0.72, 1.05, dd) * 0.8 + rs(0.16, 0.0, edge) * 0.5, 0.0, 1.0);
  vec3 cn = normalize(vec3(-mr.x, sqrt(1.0 - t * t) * mix(0.9, 0.5, isCon) + 0.08, -mr.y)
    + vec3(lump - 0.4, 0.0, fine - 0.5) * 0.9 * nearK);
  vec3 nC = normalize(cn + (N - vec3(0.0, 1.0, 0.0)) * 1.2);
  // 同一種樹成群：色相跟著幾十公尺大的區塊走，每棵只偏一點
  float grove = fbm2(vec3(cell * CS / 55.0, 2.0));
  vec3 crown = mix(broadCol(grove * 1.9 + hueZone * 0.7 + id * 0.22), conCol(id3), isCon) * (0.8 + 0.4 * fract(id * 5.3));
  crown *= mix(1.0, (0.55 + 0.75 * lump) * (0.8 + 0.4 * fine), nearK);
  // 樹冠靠外圈與樹之間的縫隙是暗的（看進林子裡面）
  crown *= (1.0 - gap * 0.8) * mix(1.0, 0.72 + 0.28 * (1.0 - t * t), 0.7);
  vec3 broadAvg = mix(vec3(0.33, 0.16, 0.06), vec3(0.27, 0.23, 0.08), hueZone);
  vec3 avg = mix(broadAvg, CON_AVG, conifer) * 0.66;
  float lod = rs(0.07, 0.3, px / CS);
  vec3 alb = mix(crown, avg, lod);
  vec3 nL = normalize(mix(nC, Nb, lod));
  // 一群群樹的明暗與色差（約 40 公尺與 150 公尺），再遠就淡掉
  float clump = fbm2(vec3(P.xz / 38.0, 5.0));
  alb *= mix(0.62 + 0.76 * clump, 1.0, rs(6.0, 30.0, px));
  alb = mix(alb, alb * vec3(1.25, 0.82, 0.6), rs(0.52, 0.75, fbm2(vec3(P.xz / 95.0, 11.0))) * (1.0 - conifer) * 0.7);
  alb *= 0.8 + 0.4 * b0;
  // 林冠的顆粒：不管多遠，都有大約幾個像素大的明暗（樹與樹影），山才不會是一片平塗
  float lg = log2(max(px, 0.4) * 2.5), l0 = floor(lg), s0 = exp2(l0);
  float grain = mix(vnoise(vec3(P.xz / s0, 1.3)), vnoise(vec3(P.xz / (s0 * 2.0), 1.3)), lg - l0);
  alb *= mix(1.0, 0.62 + 0.76 * grain, lod * rs(90.0, 20.0, px));

  // 崖下近處的山坡：實際的樹（trees.js）腳下是林床，矮竹與灌木、落葉
  float dP = length(max(abs(P.xz - vec2(0.0, 13.5)) - vec2(34.0, 26.5), 0.0));
  float under = rs(120.0, 35.0, dP);
  if (under > 0.0) {
    float u1 = fbm(vec3(P.xz / 2.6, 3.0)), u2 = fbm2(vec3(P.xz / 0.45, P.y / 0.45));
    vec3 uc = mix(vec3(0.060, 0.085, 0.035), vec3(0.15, 0.17, 0.06), rs(0.3, 0.7, u1));
    uc = mix(uc, vec3(0.20, 0.10, 0.045), rs(0.55, 0.8, fbm2(vec3(P.xz / 6.0, 9.0))) * 0.7);
    uc *= 0.55 + 0.9 * u2;
    alb = mix(alb, uc * 0.8, under);
    nL = normalize(mix(nL, normalize(N + vec3(u2 - 0.4, 0.0, u1 - 0.5) * 0.7), under));
  }

  // 陡坡露出岩壁
  float rock = rs(0.58, 0.42, N.y) * rs(0.4, 0.62, fbm2(vec3(P.xz / 25.0, P.y / 25.0)));
  alb = mix(alb, vec3(0.19, 0.17, 0.15) * (0.8 + 0.4 * fbm2(vec3(P.xz / 6.0, 2.0))), rock);

  // 溫泉所在的平台：林床（落葉與土），不畫樹冠（實際的樹在 trees.js）
  float floorM = rs(-3.0, -0.6, vH) * rs(260.0, 120.0, length(P.xz));
  vec3 floorC = mix(vec3(0.09, 0.065, 0.04), vec3(0.17, 0.10, 0.05), fbm2(vec3(P.xz / 1.7, 4.0)));
  alb = mix(alb, floorC, floorM);
  nL = normalize(mix(nL, N, floorM));

  // 聚落的地面：房子是另外蓋的實體（buildHouses），這裡只畫房子之間的巷道、空地（灰）與菜園、庭木（綠）
  float town = townMask(P.xz) * rs(0.6, 0.85, N.y) * rs(95.0, 30.0, h) * step(0.0, h);
  float townLit = 0.0;
  if (town > 0.01) {
    float dens = town * (0.35 + 0.55 * fbm2(vec3(P.xz / 70.0, 9.0)));
    float gk = fbm2(vec3(P.xz / max(px * 2.0, 14.0), 4.4));
    vec3 paved = mix(vec3(0.17, 0.165, 0.15), vec3(0.275, 0.26, 0.225), gk);
    vec3 green = mix(alb, vec3(0.15, 0.19, 0.075), 0.5);
    vec3 tc = mix(green, paved, rs(0.3, 0.55, fbm2(vec3(P.xz / 26.0, 6.1))) * (0.45 + 0.55 * dens));
    alb = mix(alb, tc, town * 0.9);
    nL = normalize(mix(nL, N, town));
    townLit = town * dens;
  }
  // 海岸：水邊一小圈濕的岩石與護岸。顏色只比山坡亮一點、遠處再淡掉，遠看才不會是一條白線
  float shore = rs(SHORE_H + px * 0.22, 0.0, hc) * (1.0 - water);
  alb = mix(alb, SHORE_COL * (0.8 + 0.4 * fbm2(vec3(P.xz / 7.0, 5.0))), shore * mix(0.7, 0.3, rs(4.0, 40.0, px)));

  // 雲影：幾公里大的明暗緩緩移動，山與海才有光影的層次（太陽在觀看者背後，少了它整片是平光）
  float shade = cloudShade(P, dist);
  float sunT = max(dot(nL, L), 0.0) * shade;
  vec3 irr = uSunCol * uSunI * sunT + mix(uHemiGround, uHemiSky, nL.y * 0.5 + 0.5) * uHemiI;
  // 聚落的燈火把附近的地面、山腳與海面染上一片暖色
  float glow = 0.0;
  for (int i = 0; i < ${TOWNS.length}; i++) { vec4 tw = uTowns[i]; vec2 dq = (P.xz - tw.xy) / (tw.z * 1.5); glow += tw.w * exp(-dot(dq, dq)); }
  vec3 land = alb * irr / PI;
  // 夜晚：星光。面向天空的坡帶一點藍灰，陡的稜線邊緣再亮一點點，山才不是一片死黑
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 6.0) * rs(0.85, 0.5, N.y);
  land += uNight * (vec3(0.0035, 0.005, 0.009) * (0.4 + 0.6 * N.y) + vec3(0.006, 0.009, 0.016) * rim);
  // 夜晚聚落地面被燈照亮的暖色
  land += uLit * (townLit * 0.035 + glow * 0.006 * rs(140.0, 20.0, h)) * vec3(1.0, 0.62, 0.3);

  // ---------- 海面 ----------
  // 波紋：遠處的格子比像素還小就淡掉，免得閃爍
  float ws = rs(3.0, 0.4, px);
  vec2 wp = P.xz * 0.12 + vec2(uTime * 0.05, uTime * 0.03);
  vec3 wn = normalize(vec3((vnoise(vec3(wp, 1.0)) - 0.5) * 0.25 * ws, 1.0, (vnoise(vec3(wp.yx * 1.3, 4.0)) - 0.5) * 0.25 * ws));
  // 風吹過的區塊：海面有亮有暗的大片紋理
  float streak = fbm2(vec3(P.x / 900.0, P.z / 260.0, 2.0));
  vec3 R = reflect(-V, wn);
  // 遠處的海面看不出個別的波，但波的斜面讓它映到的是較高處的天空、反射率也到不了 1：
  // 所以海平線附近的海比天空深，不會跟天空糊成一片白
  float farK = rs(600.0, 6000.0, dist);
  vec3 sky = skyAt(vec3(R.x, abs(R.y) + 0.16 * farK, R.z));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
  fres = min(fres, mix(1.0, 0.62, farK));
  fres *= 0.8 + 0.35 * streak;
  // 岸邊的淺水：看得到一點水底，顏色從岸邊的淺青綠漸漸變回深水的藍；也比較不反光
  float shallow = rs(SHALLOW_D + px * 0.7, 0.0, -hc);
  shallow *= shallow * mix(1.0, 0.5, rs(4.0, 30.0, px));
  vec3 body = uHemiSky * uHemiI * mix(vec3(0.03, 0.09, 0.14), SHALLOW_COL, shallow) + uSunCol * uSunI * SHALLOW_COL * 0.12 * shallow * shade;
  fres *= 1.0 - 0.55 * shallow;
  // 對岸的山的倒影：暗、帶一點林色
  vec3 hillRefl = (avg * 0.75) * (uHemiSky * uHemiI * 0.35 + uSunCol * uSunI * 0.12) / PI;
  vec3 refl = mix(sky, hillRefl, clamp(vRefl, 0.0, 1.0) * 0.9);
  vec3 sea = mix(body, refl, clamp(fres, 0.0, 1.0));
  // 夜晚的海映著星空，比陸地亮一點
  sea += uNight * vec3(0.011, 0.021, 0.044) * (0.5 + fres) * (1.0 - vRefl * 0.8);
  // 聚落的燈火映在附近海面上的一片暖色
  sea += uLit * glow * vec3(1.0, 0.6, 0.3) * 0.02 * (0.4 + fres);
  sea *= mix(1.0, 0.72 + 0.28 * shade, 1.0 - uNight);
  float sg = pow(max(dot(R, L), 0.0), 300.0) * uSunI * (1.0 - uNight);
  sea += uSunCol * sg * 2.0;

  vec3 col = mix(land, sea, water);

  // ---------- 空氣遠近：一層比一層淡、一層比一層藍，是遠景層次的主要來源；低處（海面附近）的靄比較濃 ----------
  col = applyAir(col, P, dist, water);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 崖下山坡上實際種的樹：[x, 地面高, z, 樹高上限]。
// 從望景台（EYE）看出去，正前方的樹頂要低於視線約 4 度，不擋住海灣；兩側可以高一些，當作畫框。
const EYE = { x: 0, y: 1.85, z: -11 };
export function slopeTreeSpots() {
  let seed = 9071;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const spots = [];
  for (let gz = -14; gz > -200; gz -= 6) for (let gx = -200; gx < 200; gx += 6) {
    const x = gx + (rand() - 0.5) * 5, z = gz + (rand() - 0.5) * 5;
    const dx = x - EYE.x, dz = z - EYE.z, d = Math.hypot(dx, dz);
    if (d > 190 || d < 8) continue;
    // 離崖邊越遠越稀疏（再遠就交給 shader 畫的樹冠）
    if (rand() > 1.2 - d / 170) continue;
    const y = heightAt(x, z);
    if (y > PLATEAU.y - 1.2 || y < SEA + 4) continue;
    const az = Math.abs(Math.atan2(dx, -dz)); // 0 = 正北
    const limit = (az < 0.9 ? -0.11 : az < 1.25 ? -0.03 : 0.15) - rand() * 0.07; // 樹頂仰角的上限（弧度），加亂數免得排成一條線
    const maxH = EYE.y + Math.tan(limit) * d - y - 2; // 樹冠會比樹高再多長一點
    if (maxH < 5) continue;
    spots.push([x, y, z, maxH, d < 40]);
  }
  return spots;
}


// ---------- 夜景燈火 ----------
// aFx：亮度、相位、是否在海面拉出倒影、種類（0 常亮、1 航空障礙燈慢閃、2 燈塔的閃光、3 聚落上空的光暈）
const lightVert = /* glsl */ `
attribute vec3 aCol; attribute vec4 aFx;
uniform float uLit, uPx, uTime;
varying vec3 vC; varying float vA; varying float vK;
void main(){
  vec4 mv = viewMatrix * vec4(position, 1.0);
  float d = -mv.z;
  vK = aFx.w;
  // 遠處的燈因空氣擾動微微閃爍
  float tw = 0.8 + 0.2 * sin(uTime * (1.5 + aFx.y * 5.0) + aFx.y * 40.0);
  if (aFx.w > 1.5) tw = 0.12 + 2.2 * pow(max(sin(uTime * 0.9 + aFx.y * 6.283), 0.0), 24.0);
  else if (aFx.w > 0.5) tw = 0.15 + 0.85 * smoothstep(0.35, 0.5, abs(fract(uTime * 0.45 + aFx.y) - 0.5) * 2.0);
  vA = aFx.x * uLit * tw * exp(-d / 16000.0);
  vC = aCol;
  gl_Position = projectionMatrix * mv;
  // 深度往前挪 4%（比房子的 2% 多）：燈立在房子之間，不這樣會被旁邊的房子吃掉大半
  vec4 nearer = projectionMatrix * vec4(mv.xyz * 0.96, 1.0);
  gl_Position.z = nearer.z / nearer.w * gl_Position.w;
  gl_PointSize = uPx * (2.6 + 3.6 * aFx.x) * clamp(1500.0 / d, 0.66, 2.0);
  // 種類 3：聚落上空的光暈（aFx.x 是半徑，公尺），不閃
  if (aFx.w > 2.5) { vA = uLit * 0.036 * exp(-d / 16000.0) * smoothstep(900.0, 2600.0, d); gl_PointSize = uPx * clamp(aFx.x * 640.0 / d, 6.0, 200.0); }
}`;
const lightFrag = /* glsl */ `
varying vec3 vC; varying float vA; varying float vK;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float a = (vK > 2.5 ? exp(-r * 3.5) - 0.03 : exp(-r * 9.0) + exp(-r * 2.5) * 0.22) * vA;
  gl_FragColor = vec4(vC * max(a, 0.0) * 2.4, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// 海面上的倒影：燈對海面的鏡像點，沿視線落在海面上的位置，拉成一條上下抖動的光條
const streakVert = /* glsl */ `
attribute vec3 aCol; attribute vec4 aFx;
uniform float uLit, uPx, uTime;
varying vec3 vC; varying float vA; varying float vSize; varying float vPh;
void main(){
  vec3 m = vec3(position.x, 2.0 * ${SEA.toFixed(1)} - position.y, position.z);
  vec3 c = cameraPosition;
  float t = (c.y - ${SEA.toFixed(1)}) / max(c.y - m.y, 0.01);
  vec3 w = c + (m - c) * t;
  w.y = ${SEA.toFixed(1)};
  vec4 mv = viewMatrix * vec4(w, 1.0);
  float d = -mv.z;
  float tw = aFx.w > 1.5 && aFx.w < 2.5 ? 0.12 + 2.2 * pow(max(sin(uTime * 0.9 + aFx.y * 6.283), 0.0), 24.0) : 1.0;
  vA = aFx.z * aFx.x * uLit * tw * exp(-d / 14000.0);
  vC = aCol; vPh = aFx.y;
  gl_Position = projectionMatrix * mv;
  // 深度往前挪 4%：幾公里外的深度精度只有十公尺上下，貼著海面的點會被海面自己吃掉
  vec4 nearer = projectionMatrix * vec4(mv.xyz * 0.96, 1.0);
  gl_Position.z = nearer.z / nearer.w * gl_Position.w;
  vSize = uPx * (11.0 + 22.0 * aFx.x) * clamp(1500.0 / d, 0.5, 1.6);
  gl_PointSize = aFx.z > 0.5 ? vSize : 0.0;
}`;
const streakFrag = /* glsl */ `
uniform float uTime, uPx;
varying vec3 vC; varying float vA; varying float vSize; varying float vPh;
void main(){
  vec2 uv = gl_PointCoord;
  float gx = (uv.x - 0.5) * vSize / (1.25 * uPx);
  float line = exp(-gx * gx);
  float y = uv.y - 0.3; // 光條大多落在燈的下方（靠近觀看者那側）
  float prof = exp(-y * y / (y < 0.0 ? 0.008 : 0.09));
  float dash = 0.5 + 0.5 * sin(uv.y * vSize * 0.5 / uPx + uTime * 2.2 + vPh * 30.0);
  float a = line * prof * dash * vA;
  gl_FragColor = vec4(vC * a * 1.5, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 夜景的燈量：1 是 2026-11-13 第二輪的量（使用者嫌少），整體照比例增減
const LIGHT_DENSITY = 2.8;
// 最密的幾個聚落（密度 0.9 以上：主灣兩岸與對岸兩個灣口）再照這個比例減：使用者覺得 7750 盞稍多，要從最密的地方減到約 7000 盞
const DENSE_TRIM = 0.83;
const LCOL = {
  warm: [1.0, 0.8, 0.52], sodium: [1.0, 0.56, 0.2], white: [0.92, 0.93, 0.95], cool: [0.75, 0.86, 1.0], red: [1.0, 0.12, 0.08], green: [0.4, 1.0, 0.6],
};
function pickCol(r) { return r < 0.45 ? LCOL.warm : r < 0.72 ? LCOL.sodium : r < 0.9 ? LCOL.white : LCOL.cool; }

// 燈火不是一片均勻的亮點，而是有結構的：
// 聚落裡一條條沿等高線的街（幾盞燈排成一小串）、從聚落沿海岸與往山上延伸的道路（等距的路燈）、
// 海岸邊零星的小聚落、灣裡的船與外海的漁火、岬角的燈塔、山頂的航空障礙燈。
function buildLights(radii, H, W, cos, sin, rand) {
  const pos = [], col = [], fx = [];
  const hamlets = []; // [x, z, 棟數, 種類（0 民家、1 山腰的旅館或寺）]：聚落以外有燈的地方，白天在同一處蓋房子（buildHouses）
  const add = (x, y, z, c, i, refl, kind = 0) => { pos.push(x, y, z); col.push(...c); fx.push(i, rand(), refl ? 1 : 0, kind); };
  // 陸上的一盞燈；燈前（朝觀看者那側）不遠就是海的，才在海面拉出倒影
  const land = (x, z, c, i, lift = 5) => {
    const h = heightAt(x, z);
    if (h < SEA + 1.2) return false;
    const r = Math.hypot(x, z) || 1;
    const refl = h < SEA + 22 && (heightAt(x - (x / r) * 45, z - (z / r) * 45) < SEA || heightAt(x - (x / r) * 110, z - (z / r) * 110) < SEA);
    add(x, h + lift + rand() * 3, z, c, i, refl);
    return true;
  };
  const dim = () => 0.2 + 0.6 * rand() ** 2.5; // 多數的燈偏暗，少數較亮
  // 沿等高線的方向（坡太平就隨便）
  const contour = (x, z) => {
    const h = heightAt(x, z), gx = heightAt(x + 8, z) - h, gz = heightAt(x, z + 8) - h;
    return Math.hypot(gx, gz) < 0.25 ? rand() * Math.PI : Math.atan2(gx, -gz);
  };
  // 道路：每一步在幾個方向裡挑最接近目標高度的，沿途等距立路燈。target(s) 是走了 s 公尺時想待的離海高度
  const road = (x, z, dir, len, target, c, spacing, bright) => {
    const STEP = 14;
    let since = spacing * rand();
    for (let s = 0; s < len; s += STEP) {
      let best = null, bc = 1e9;
      for (const da of [-0.55, -0.28, 0, 0.28, 0.55]) {
        const a = dir + da, nx = x + Math.cos(a) * STEP, nz = z + Math.sin(a) * STEP, nh = heightAt(nx, nz) - SEA;
        if (nh < 1.5) continue;
        const cost = Math.abs(nh - target(s)) + Math.abs(da) * 5;
        if (cost < bc) { bc = cost; best = [nx, nz, a]; }
      }
      if (!best) return;
      [x, z, dir] = best;
      since += STEP;
      if (since >= spacing) { since = 0; land(x, z, c, bright * (0.8 + 0.4 * rand()), 7); }
    }
  };
  // 一小串街燈與人家
  const street = (x, z, n, sp) => {
    const dir = contour(x, z), base = pickCol(rand());
    for (let m = 0; m < n; m++) {
      const u = (m - (n - 1) / 2) * sp;
      const big = rand() < 0.04; // 偶爾有較亮的（大樓、加油站、港口照明）
      land(x + Math.cos(dir) * u + (rand() - 0.5) * 8, z + Math.sin(dir) * u + (rand() - 0.5) * 8,
        big ? LCOL.white : rand() < 0.6 ? base : pickCol(rand()), big ? 0.8 + rand() * 0.4 : dim());
    }
  };

  // 1) 聚落：中心密、往外與往山上漸疏（燈量看 LIGHT_DENSITY）
  for (const [tx, tz, tr, td] of TOWNS) {
    const n = Math.round(tr * tr * td / 4300 * LIGHT_DENSITY * (td >= 0.9 ? DENSE_TRIM : 1));
    for (let k = 0, placed = 0; k < n * 6 && placed < n; k++) {
      const a = rand() * Math.PI * 2, rr = tr * 1.5 * Math.pow(rand(), 0.75);
      const x = tx + Math.cos(a) * rr, z = tz + Math.sin(a) * rr;
      const up = heightAt(x, z) - SEA;
      if (up < 1.5 || rand() > Math.exp(-up / 65)) continue;
      placed++;
      street(x, z, 3 + Math.floor(rand() * 6), 18 + rand() * 20);
    }
    // 聚落上空的光暈
    for (let m = 0; m < 3; m++) {
      const x = tx + (rand() - 0.5) * tr * 0.9, z = tz + (rand() - 0.5) * tr * 0.9;
      pos.push(x, Math.max(heightAt(x, z), SEA) + 20, z); col.push(1.0, 0.62, 0.3); fx.push(tr * (0.5 + 0.3 * td), rand(), 0, 3);
    }
    // 從聚落出發的道路：先往下找到海岸，沿岸往兩邊各一條；再往山上兩條
    let cx = tx, cz = tz;
    for (let i = 0; i < 60 && heightAt(cx, cz) > SEA + 5; i++) {
      const h = heightAt(cx, cz), gx = heightAt(cx + 10, cz) - h, gz = heightAt(cx, cz + 10) - h, gl = Math.hypot(gx, gz) || 1;
      cx -= (gx / gl) * 12; cz -= (gz / gl) * 12;
    }
    const along = contour(cx, cz);
    for (const sgn of [0, Math.PI]) road(cx, cz, along + sgn, tr * (4 + rand() * 4), () => 5, LCOL.sodium, 28 + rand() * 10, 0.42);
    for (let i = 0; i < 3; i++) {
      const top = 45 + rand() * 90, len = tr * (1.8 + rand() * 1.6);
      road(tx, tz, rand() * Math.PI * 2, len, (s) => 8 + (top - 8) * Math.min(1, s / (len * 0.8)), rand() < 0.5 ? LCOL.sodium : LCOL.warm, 36 + rand() * 18, 0.32);
    }
    // 港：岸壁上一整排明亮的鈉燈（大的聚落才有），在海面拉出長長的倒影
    if (td >= 0.8) {
      const nq = 10 + Math.floor(rand() * 10), ca = Math.cos(along), sa = Math.sin(along);
      for (let m = 0; m < nq; m++) {
        const u = (m - nq / 2) * 16;
        add(cx + ca * u, SEA + 9, cz + sa * u, m % 5 === 2 ? LCOL.white : LCOL.sodium, 0.62 + rand() * 0.3, true);
      }
    }
  }
  // 2) 海岸邊零星的小聚落與獨棟人家：沿網格的放射線找出跨過海岸的位置
  const NA_ = W - 1, coast = [];
  for (let j = 0; j < NA_; j += 2) for (let i = 8; i < radii.length - 1; i++) {
    const h0 = H[i * W + j], h1 = H[(i + 1) * W + j], c = SEA + 3;
    if ((h0 - c) * (h1 - c) > 0) continue;
    const r = radii[i] + (radii[i + 1] - radii[i]) * ((c - h0) / (h1 - h0)) + (h1 > h0 ? 12 : -12);
    if (r < 26000) coast.push([cos[j] * r, sin[j] * r]);
  }
  for (const [x, z] of coast) {
    const k = rand();
    if (k < 0.07) {
      const n = 1 + Math.floor(rand() * 4);
      for (let m = 0; m < n; m++) {
        const sx = x + (rand() - 0.5) * 110, sz = z + (rand() - 0.5) * 110, sn = 2 + Math.floor(rand() * 5);
        street(sx, sz, sn, 18 + rand() * 16);
        hamlets.push([sx, sz, sn, 0]);
      }
      if (rand() < 0.6) road(x, z, contour(x, z) + (rand() < 0.5 ? Math.PI : 0), 300 + rand() * 700, () => 5, LCOL.sodium, 34, 0.36);
    } else if (k < 0.2) { if (land(x, z, pickCol(rand()), dim())) hamlets.push([x, z, 1, 0]); }
  }
  // 3) 山腰上零星的燈（旅館、寺、展望所）
  for (let k = 0, n = 0; k < 8000 && n < 70; k++) {
    const x = (rand() - 0.5) * 16000, z = -300 - rand() * 10000, up = heightAt(x, z) - SEA;
    if (up < 40 || up > 320) continue;
    n++;
    street(x, z, 1 + Math.floor(rand() * 3), 16);
    hamlets.push([x, z, 1, 1]);
  }
  // 4) 灣裡的船（桅燈＋舷燈）
  for (const [x, z] of [[320, -930], [-560, -2650], [980, -3050], [-150, -5300], [-1250, -1350], [1700, -1500], [150, -2300], [-300, -3600], [700, -1800]]) {
    if (heightAt(x, z) > SEA - 2) continue;
    add(x, SEA + 5, z, LCOL.white, 0.6, true);
    add(x + 7, SEA + 3, z + 2, rand() < 0.5 ? LCOL.green : LCOL.red, 0.3, true);
  }
  // 5) 漁火：水道裡幾群，外海的海平線上一整排（集魚燈，又白又亮）
  for (const [gx, gz, n] of [[-500, -7800, 4], [-900, -9300, 4], [-300, -6500, 3], [-1300, -11500, 5]]) {
    for (let m = 0; m < n; m++) {
      const x = gx + (rand() - 0.5) * 1500, z = gz + (rand() - 0.5) * 900;
      if (heightAt(x, z) < SEA - 2) add(x, SEA + 8, z, LCOL.cool, 0.75 + rand() * 0.4, true);
    }
  }
  for (let m = 0; m < 70; m++) {
    const az = (rand() - 0.5) * 2.4, r = 14000 + rand() * 27000, x = Math.sin(az) * r, z = -Math.cos(az) * r;
    if (heightAt(x, z) < SEA - 2) add(x, SEA + 10, z, LCOL.cool, 1.1 + rand() * 0.5, true);
  }
  // 6) 燈塔（小島的頂上、岬角）與遠方山頂的航空障礙燈
  for (const [x, z] of [[540, -2180], [-1250, -2560], [700, -5300], [-700, -7300], [-1500, -13500]]) {
    const h = heightAt(x, z);
    if (h > SEA) add(x, h + 12, z, LCOL.white, 1.3, true, 2);
  }
  for (const [x, z] of [[-3500, -1800], [3500, -1150], [-5300, -4600], [5600, -3800], [4700, -7500], [-6400, -8500]]) add(x, heightAt(x, z) + 30, z, LCOL.red, 0.7, false, 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFx', new THREE.Float32BufferAttribute(fx, 4));
  return { geo: g, hamlets };
}

// ---------- 聚落的建築 ----------
// 白天從望景台看得出一棟棟的房子：每棟是一個方盒加山形屋頂（平屋頂的大樓把屋頂高設成 0），全部合成一個 instanced mesh。
// 排法跟燈火一樣是「沿等高線的一條條街」，街的兩側各一排；港邊有幾棟長長的倉庫，中心偶爾有幾層樓的大樓。
const houseVert = /* glsl */ `
attribute vec3 aK;   // 是否屋頂、沿牆面的座標（-0.5～0.5）、牆面沿哪個軸（0 長邊、1 短邊）
attribute vec4 aPos; // x、地面高、z、朝向
attribute vec4 aDim; // 長、牆高、深、屋頂高
attribute vec3 aRoof, aWall;
varying vec3 vW, vRoof, vWall; varying float vK, vTop; varying vec2 vUv;
void main(){
  // 牆腳往地下多埋 3 公尺，蓋在斜坡上才不會懸空
  float y = position.y < 0.5 ? -3.0 : aDim.y + aDim.w * (position.y - 1.0);
  vec2 l = position.xz * aDim.xz;
  float c = cos(aPos.w), s = sin(aPos.w);
  vW = vec3(aPos.x + l.x * c - l.y * s, aPos.y + y, aPos.z + l.x * s + l.y * c);
  vK = aK.x; vTop = aDim.y; vRoof = aRoof; vWall = aWall;
  vUv = vec2(aK.y * (aK.z > 0.5 ? aDim.z : aDim.x), y);
  vec4 mv = viewMatrix * vec4(vW, 1.0);
  gl_Position = projectionMatrix * mv;
  // 深度往前挪 2%：幾公里外的深度精度不夠分辨房子與它腳下的地面
  vec4 nearer = projectionMatrix * vec4(mv.xyz * 0.98, 1.0);
  gl_Position.z = nearer.z / nearer.w * gl_Position.w;
}`;
const houseFrag = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uHemiSky, uHemiGround, uHaze, uSkyTop, uSkyHorizon;
uniform float uSunI, uHemiI, uNight, uTime, uLit, uAir;
varying vec3 vW, vRoof, vWall; varying float vK, vTop; varying vec2 vUv;
${GLSL_NOISE}
const float SEA = ${SEA.toFixed(1)};
const float PI = 3.14159265;
${GLSL_AIR}
void main(){
  vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
  vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(N, V) < 0.0) N = -N;
  vec3 alb;
  if (vK > 0.5) {
    alb = vRoof;
  } else {
    // 牆：每層樓一排窗（遠到分不出來時換成平均的明度），牆腳被庭木與鄰屋擋著，暗一點
    float pw = max(fwidth(vUv.x), fwidth(vUv.y));
    float fl = fract(vUv.y / 2.9), bay = fract(vUv.x / 2.4 + 0.5);
    float win = step(0.36, fl) * step(fl, 0.76) * step(0.24, bay) * step(bay, 0.78) * step(0.0, vUv.y) * step(vUv.y, vTop - 0.2);
    float nearK = rs(1.5, 0.5, pw);
    alb = vWall * mix(0.84, 1.0 - 0.85 * win, nearK);
    alb *= (0.6 + 0.4 * rs(-0.5, 2.6, vUv.y)) * (0.72 + 0.28 * rs(vTop - 0.1, vTop - 1.0, vUv.y)); // 簷下也暗
  }
  float sunT = max(dot(N, normalize(uSunDir)), 0.0) * cloudShade(vW, dist);
  vec3 irr = uSunCol * uSunI * sunT + mix(uHemiGround, uHemiSky, N.y * 0.5 + 0.5) * uHemiI;
  vec3 col = alb * irr / PI;
  col += uNight * vec3(0.0035, 0.005, 0.009) * (0.4 + 0.6 * N.y);
  // 夜晚被街燈照到的牆面與屋頂
  col += uLit * (0.25 + alb) * 0.02 * vec3(1.0, 0.62, 0.3);
  col = applyAir(col, vW, dist, 0.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 一棟房子的單位形狀：x 是長邊（屋脊方向），y 的 0／1／2 分別是牆腳、簷口、屋脊；屋頂比牆多伸出一圈屋簷
function houseGeometry() {
  const pos = [], k = [];
  const tri = (a, b, c, roof, axis) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3 - 0.9, cz = (a[2] + b[2] + c[2]) / 3;
    if (nx * cx + ny * cy + nz * cz < 0) [b, c] = [c, b]; // 正面一律朝外
    for (const p of [a, b, c]) { pos.push(...p); k.push(roof, axis ? p[2] : p[0], axis); }
  };
  const quad = (a, b, c, d, roof, axis) => { tri(a, b, c, roof, axis); tri(a, c, d, roof, axis); };
  for (const z of [-0.5, 0.5]) {
    quad([-0.5, 0, z], [0.5, 0, z], [0.5, 1, z], [-0.5, 1, z], 0, 0);
    quad([-0.56, 0.76, z * 1.24], [0.56, 0.76, z * 1.24], [0.56, 2, 0], [-0.56, 2, 0], 1, 0);
  }
  for (const x of [-0.5, 0.5]) {
    quad([x, 0, -0.5], [x, 0, 0.5], [x, 1, 0.5], [x, 1, -0.5], 0, 1);
    tri([x, 1, -0.5], [x, 1, 0.5], [x, 2, 0], 0, 1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(k, 3));
  return g;
}

// 屋頂：燻瓦的深灰最多，其次銀灰、藍瓦、紅褐的鐵皮、焦茶；牆：白、米、淺灰、木板
const ROOF_COLS = [[0.34, [0.15, 0.16, 0.18]], [0.2, [0.36, 0.37, 0.38]], [0.13, [0.13, 0.19, 0.29]], [0.13, [0.36, 0.17, 0.11]], [0.1, [0.13, 0.10, 0.09]], [0.05, [0.19, 0.29, 0.26]], [0.05, [0.58, 0.58, 0.56]]];
const WALL_COLS = [[0.3, [0.68, 0.66, 0.61]], [0.2, [0.62, 0.55, 0.44]], [0.12, [0.50, 0.50, 0.49]], [0.26, [0.28, 0.20, 0.13]], [0.12, [0.52, 0.41, 0.30]]];
// 配色往周圍山林的秋色靠一點（0 是原色）：使用者覺得聚落的顏色跟環境有點分離，但只要動一點點
const TOWN_BLEND = 0.16, TOWN_TINT = [0.31, 0.25, 0.17];
for (const [, c] of [...ROOF_COLS, ...WALL_COLS]) for (let i = 0; i < 3; i++) c[i] += (TOWN_TINT[i] - c[i]) * TOWN_BLEND;
const HOUSE_DENSITY = 1; // 聚落裡房子的密度（街的條數照比例增減）

function buildHouses(hamlets) {
  let seed = 7411;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (list) => { let r = rand(); for (const [w, c] of list) { if ((r -= w) < 0) return c; } return list[0][1]; };
  const aPos = [], aDim = [], aRoof = [], aWall = [];
  // 不讓房子疊在一起：30 公尺的格子裡記下每棟的位置與半徑
  const grid = new Map(), CELL = 30;
  const put = (x, z, yaw, w, d, wh, rh, roof, wall) => {
    const h = heightAt(x, z);
    if (h < SEA + 1.6) return false;
    if (Math.hypot(heightAt(x + 6, z) - h, heightAt(x, z + 6) - h) > 4.2) return false; // 太陡不蓋
    const r = Math.max(w, d) * 0.5 + 0.8, gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      for (const [ox, oz, or] of grid.get(`${gx + i},${gz + j}`) || []) if (Math.hypot(x - ox, z - oz) < (r + or) * 0.82) return false;
    }
    const key = `${gx},${gz}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([x, z, r]);
    const sh = 0.85 + 0.3 * rand(); // 每棟的新舊、明暗
    aPos.push(x, h, z, yaw); aDim.push(w, wh, d, rh);
    aRoof.push(roof[0] * sh, roof[1] * sh, roof[2] * sh); aWall.push(wall[0] * sh, wall[1] * sh, wall[2] * sh);
    return true;
  };
  const contour = (x, z) => {
    const h = heightAt(x, z), gx = heightAt(x + 8, z) - h, gz = heightAt(x, z + 8) - h;
    return Math.hypot(gx, gz) < 0.25 ? rand() * Math.PI : Math.atan2(gx, -gz);
  };
  // 一棟民家：平房或兩層，屋脊多半順著街
  const house = (x, z, dir) => {
    const w = 7 + rand() * 5, d = 6 + rand() * 2.4, two = rand() < 0.45, turn = rand() < 0.22;
    return put(x, z, dir + (turn ? Math.PI / 2 : 0) + (rand() - 0.5) * 0.12, turn ? d : w, turn ? w : d, two ? 5.3 + rand() * 0.6 : 2.9 + rand() * 0.4, 2.1 + rand() * 1.3, pick(ROOF_COLS), pick(WALL_COLS));
  };
  // 一條街：兩側各一排
  const row = (x, z, n, core) => {
    const dir = contour(x, z), ca = Math.cos(dir), sa = Math.sin(dir);
    let u = -n * 6.5;
    for (let m = 0; m < n; m++) {
      u += 11 + rand() * 5;
      for (const side of [-1, 1]) {
        if (rand() > 0.85) continue;
        const off = side * (6.5 + rand() * 2), px = x + ca * u - sa * off, pz = z + sa * u + ca * off;
        if (core && rand() < 0.045) { // 公寓、學校、公所：平屋頂、幾層樓
          const g = 0.5 + rand() * 0.22;
          put(px, pz, dir, 16 + rand() * 18, 10 + rand() * 5, 8.7 + Math.floor(rand() * 4) * 2.9, 0, [0.4, 0.4, 0.39], [g + 0.06, g + 0.05, g]);
        } else house(px, pz, dir);
      }
    }
  };

  for (const [tx, tz, tr, td] of TOWNS) {
    // 港邊的倉庫與漁協（大的聚落才有）：先往下坡找到海岸，沿岸排開
    if (td >= 0.8) {
      let cx = tx, cz = tz, ux = 0, uz = 0;
      for (let i = 0; i < 60 && heightAt(cx, cz) > SEA + 5; i++) {
        const h = heightAt(cx, cz), gx = heightAt(cx + 10, cz) - h, gz = heightAt(cx, cz + 10) - h, gl = Math.hypot(gx, gz) || 1;
        ux = gx / gl; uz = gz / gl;
        cx -= ux * 12; cz -= uz * 12;
      }
      const along = contour(cx, cz), ca = Math.cos(along), sa = Math.sin(along), nw = 4 + Math.floor(rand() * 4);
      for (let m = 0; m < nw; m++) {
        const u = (m - (nw - 1) / 2) * (50 + rand() * 14), in_ = 14 + rand() * 22;
        put(cx + ca * u + ux * in_, cz + sa * u + uz * in_, along + (rand() - 0.5) * 0.1, 26 + rand() * 20, 13 + rand() * 6, 6 + rand() * 2.5, 2 + rand(),
          pick([[0.4, [0.40, 0.47, 0.53]], [0.3, [0.42, 0.22, 0.14]], [0.3, [0.52, 0.53, 0.53]]]), [0.6, 0.6, 0.58]);
      }
    }
    const n = Math.round(tr * tr * td / 1000 * HOUSE_DENSITY);
    for (let k = 0, placed = 0; k < n * 10 && placed < n; k++) {
      const a = rand() * Math.PI * 2, rr = tr * 1.02 * Math.pow(rand(), 0.7);
      const x = tx + Math.cos(a) * rr, z = tz + Math.sin(a) * rr, up = heightAt(x, z) - SEA;
      if (up < 2 || rand() > sstep(tr, tr * 0.35, rr) * Math.exp(-up / 60)) continue;
      placed++;
      row(x, z, 3 + Math.floor(rand() * 7), rr < tr * 0.5);
    }
  }
  // 聚落以外：海岸的小聚落與獨棟人家、山腰的旅館與寺（位置與夜晚的燈一致）
  for (const [x, z, n, kind] of hamlets) {
    if (kind === 1) put(x, z, contour(x, z), 15 + rand() * 12, 9 + rand() * 4, 6 + rand() * 3, 2.4 + rand() * 1.2, pick(ROOF_COLS), pick(WALL_COLS));
    else if (n === 1) house(x, z, contour(x, z));
    else row(x, z, n, false);
  }

  const g = houseGeometry();
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(aPos), 4));
  g.setAttribute('aDim', new THREE.InstancedBufferAttribute(new Float32Array(aDim), 4));
  g.setAttribute('aRoof', new THREE.InstancedBufferAttribute(new Float32Array(aRoof), 3));
  g.setAttribute('aWall', new THREE.InstancedBufferAttribute(new Float32Array(aWall), 3));
  g.instanceCount = aPos.length / 4;
  return g;
}

export function createVista(scene, { sun, hemi }) {
  const radii = ringRadii(), NR = radii.length;
  const cos = new Float32Array(NA + 1), sin = new Float32Array(NA + 1);
  for (let j = 0; j <= NA; j++) { const a = (j / NA) * Math.PI * 2; cos[j] = Math.cos(a); sin[j] = Math.sin(a); }

  // 高度（每一圈 NA+1 個點，最後一個與第一個重合，貼圖接縫不必特別處理）
  const W = NA + 1;
  const H = new Float32Array(NR * W);
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) H[i * W + j] = heightAt(radii[i] * cos[j], radii[i] * sin[j]);
  for (let i = 0; i < NR; i++) H[i * W + NA] = H[i * W];

  // 海面上的倒影：從海面上一點往遠處看，仰角等於從望景台俯視這點的角度；
  // 若遠處有山高過這條視線，這裡映的就是山。網格是以原點為中心的放射狀，沿同一條放射線往外找即可。
  const refl = new Float32Array(NR * W);
  for (let j = 0; j < NA; j++) {
    for (let i = 1; i < NR; i++) {
      if (H[i * W + j] >= SEA) continue;
      const tanA = (EYE_Y - SEA) / radii[i];
      let best = 0;
      for (let k = i + 1; k < NR; k++) {
        const s = radii[k] - radii[i], need = s * tanA;
        if (need > 720) break;
        const over = H[k * W + j] - SEA - need;
        if (over > 0) { best = Math.max(best, Math.min(1, over / 25)); if (best >= 1) break; }
      }
      refl[i * W + j] = best;
    }
  }
  // 岸上的頂點沿用隔壁海面頂點的值：否則內插到岸邊會變回 0，緊貼岸邊的一圈海面映的是天空，遠看就是一條亮線
  const wet = refl.slice();
  for (let i = 1; i < NR - 1; i++) for (let j = 0; j < NA; j++) {
    if (H[i * W + j] < SEA) continue;
    let m = 0;
    for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const k = (i + di) * W + (j + dj + NA) % NA;
      if (H[k] < SEA) m = Math.max(m, wet[k]);
    }
    refl[i * W + j] = m;
  }
  for (let i = 0; i < NR; i++) refl[i * W + NA] = refl[i * W];

  const pos = new Float32Array(NR * W * 3);
  for (let i = 0; i < NR; i++) for (let j = 0; j <= NA; j++) {
    const k = i * W + j;
    pos[k * 3] = radii[i] * cos[j];
    pos[k * 3 + 1] = Math.max(H[k], SEA);
    pos[k * 3 + 2] = radii[i] * sin[j];
  }
  const idx = new Uint32Array((NR - 1) * NA * 6);
  let o = 0;
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NA; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx[o++] = a; idx[o++] = b; idx[o++] = c;
    idx[o++] = b; idx[o++] = d; idx[o++] = c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aH', new THREE.BufferAttribute(H, 1));
  geo.setAttribute('aRefl', new THREE.BufferAttribute(refl, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const uniforms = {
    uSunDir: G.sunDir, uSkyTop: G.skyTop, uSkyHorizon: G.skyHorizon, uNight: G.night, uTime: G.uTime,
    uSunCol: { value: new THREE.Color() }, uSunI: { value: 1 },
    uHemiSky: { value: new THREE.Color() }, uHemiGround: { value: new THREE.Color() }, uHemiI: { value: 1 },
    uHaze: { value: scene.fog.color },
    uLit: { value: 0 },
    uAir: { value: 20000 }, // 空氣遠近的特徵距離（公尺）：越小越朦朧
    uTowns: { value: TOWNS.map(([x, z, r, d]) => new THREE.Vector4(x, z, r, d)) },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, fog: false });
  mat.extensions = { derivatives: true };
  const terrain = new THREE.Mesh(geo, mat);
  terrain.receiveShadow = false;
  terrain.frustumCulled = false;
  scene.add(terrain);

  let seed = 5150;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const { geo: lgeo, hamlets } = buildLights(radii, H, W, cos, sin, rand);

  const hgeo = buildHouses(hamlets);
  const houses = new THREE.Mesh(hgeo, new THREE.ShaderMaterial({ vertexShader: houseVert, fragmentShader: houseFrag, uniforms, fog: false }));
  houses.frustumCulled = false;
  scene.add(houses);
  const lu = { uLit: uniforms.uLit, uTime: G.uTime, uPx: { value: Math.min(devicePixelRatio, 2) } };
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
  const lightPts = new THREE.Points(lgeo, new THREE.ShaderMaterial({ uniforms: lu, vertexShader: lightVert, fragmentShader: lightFrag, ...add }));
  const streaks = new THREE.Points(lgeo, new THREE.ShaderMaterial({ uniforms: lu, vertexShader: streakVert, fragmentShader: streakFrag, ...add }));
  lightPts.frustumCulled = streaks.frustumCulled = false;
  scene.add(lightPts, streaks);

  return {
    terrain, uniforms, houses, houseCount: hgeo.instanceCount, lights: lightPts, streaks, lightCount: lgeo.attributes.position.count,
    heightAt,
    update() {
      uniforms.uSunCol.value.copy(sun.color);
      uniforms.uSunI.value = sun.intensity;
      uniforms.uHemiSky.value.copy(hemi.color);
      uniforms.uHemiGround.value.copy(hemi.groundColor);
      uniforms.uHemiI.value = hemi.intensity;
      uniforms.uLit.value = Math.min(1, Math.max(0, (G.night.value - 0.3) / 0.45)); // 黃昏時聚落的燈亮了四成多
      lightPts.visible = streaks.visible = uniforms.uLit.value > 0;
    },
  };
}
