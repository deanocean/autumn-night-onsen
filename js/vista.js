// 遠景：從溫泉的崖邊往北看下去的海灣。地形高度在 terrain.js；這裡把它蓋成網格、上色、點燈。
// - 網格是以原點為中心的極座標格子：近處密、遠處疏，一路延伸到約 12 公里外。
// - 陸地、海面、聚落都在同一個 shader 裡：低於海面的頂點壓平成海面，片段依「原始高度」判斷是水是陸，
//   海岸線因此沒有兩層網格交疊的閃爍。
// - 陸地：遠看是一顆顆樹冠的明暗（Voronoi 格子當樹冠），紅、橙、黃與杉綠依區塊混色；越遠越模糊成平均色。
// - 海面：反射天色（越斜看越亮）；對岸的山在海面上的倒影由 JS 預先沿視線方向算好（aRefl）。
// - 夜晚：聚落與沿岸道路的燈火（Points），近水的燈在海面拉出倒影光條。
import * as THREE from 'three';
import { G } from './env.js';
import { GLSL_NOISE } from './shaders.js';
import { SEA, heightAt, TOWNS, PLATEAU } from './terrain.js';

const R_MAX = 12400;
const NA = 720; // 一圈的格數
const EYE_Y = 1.85;

function ringRadii() {
  const r = [0];
  let x = 2;
  while (x < 44) { r.push(x); x += 1.2; }
  while (x < R_MAX) { r.push(x); x *= 1.021; }
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

const frag = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uHemiSky, uHemiGround, uHaze, uSkyTop, uSkyHorizon;
uniform float uSunI, uHemiI, uNight, uTime, uLit;
uniform vec4 uTowns[${TOWNS.length}];
varying vec3 vW; varying float vH; varying vec3 vN; varying float vRefl;
${GLSL_NOISE}
const float SEA = ${SEA.toFixed(1)};
const float PI = 3.14159265;

// 樹冠的顏色：闊葉（紅、橙、黃、褐、殘綠）與杉、檜（深綠）
vec3 broadCol(float h, float zone){
  // zone 讓某些坡面偏紅、某些偏黃，不是均勻的胡椒鹽；遠看秋天的山仍以褐綠為底，紅黃是點綴
  h = fract(h + zone * 0.6);
  if (h < 0.12) return vec3(0.40, 0.11, 0.06);
  if (h < 0.24) return vec3(0.48, 0.21, 0.08);
  if (h < 0.36) return vec3(0.52, 0.34, 0.10);
  if (h < 0.48) return vec3(0.44, 0.38, 0.14);
  if (h < 0.68) return vec3(0.27, 0.21, 0.11);
  return vec3(0.20, 0.25, 0.11);
}
const vec3 BROAD_AVG = vec3(0.32, 0.24, 0.11);
vec3 conCol(float h){ return mix(vec3(0.06, 0.12, 0.07), vec3(0.12, 0.18, 0.10), h); }
const vec3 CON_AVG = vec3(0.09, 0.15, 0.085);

float townMask(vec2 p){
  float m = 0.0;
  for (int i = 0; i < ${TOWNS.length}; i++) {
    vec4 t = uTowns[i];
    m = max(m, rs(t.z, t.z * 0.35, length(p - t.xy)) * t.w);
  }
  return m;
}

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
  float conifer = clamp(rs(0.3, 0.6, zone) * 0.6 + 0.3, 0.0, 1.0);
  float hueZone = fbm2(vec3(P.xz / 160.0, 8.0));

  // 樹冠：Voronoi 格子，每格一棵樹，以到中心的向量做出圓頂的法線
  const float CS = 6.5;
  vec2 q = P.xz / CS, n = floor(q), f = fract(q);
  float md = 8.0, md2 = 8.0; vec2 mr = vec2(0.0), mc = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash2(n + g) * 0.8 + 0.1 - f;
    float d = dot(r, r);
    if (d < md) { md2 = md; md = d; mr = r; mc = g; } else if (d < md2) md2 = d;
  }
  float id = hash21(n + mc), id2 = fract(id * 37.13), id3 = fract(id * 91.7);
  float isCon = step(id2, conifer);
  float rad = 0.58 + 0.2 * id3;
  float t = clamp(sqrt(md) / rad, 0.0, 1.0);
  float gap = rs(0.7, 1.0, sqrt(md) / rad) * 0.7 + rs(0.12, 0.0, sqrt(md2) - sqrt(md)) * 0.3;
  vec3 cn = normalize(vec3(-mr.x, sqrt(1.0 - t * t) * mix(0.9, 0.5, isCon) + 0.08, -mr.y));
  vec3 nC = normalize(cn + (N - vec3(0.0, 1.0, 0.0)) * 1.2);
  vec3 crown = mix(broadCol(id, hueZone), conCol(id3), isCon) * (0.75 + 0.5 * fract(id * 5.3));
  vec3 broadAvg = mix(vec3(0.36, 0.20, 0.09), vec3(0.30, 0.28, 0.12), hueZone);
  vec3 avg = mix(broadAvg, CON_AVG, conifer) * 0.82;
  // 近看：樹冠裡的葉叢顆粒
  crown *= mix(0.7 + 0.6 * fbm2(vec3(P.xz / 0.7, P.y / 0.7)), 1.0, rs(0.05, 0.3, px));
  float lod = rs(0.07, 0.3, px / CS);
  vec3 alb = mix(crown * (1.0 - gap * 0.75), avg * 0.85, lod);
  vec3 nL = normalize(mix(nC, N, lod));
  // 一群群樹的明暗（約 40 公尺），再遠就淡掉
  alb *= mix(0.78 + 0.44 * fbm2(vec3(P.xz / 38.0, 5.0)), 1.0, rs(6.0, 25.0, px));

  // 陡坡露出岩壁
  float rock = rs(0.62, 0.45, N.y) * rs(0.35, 0.6, fbm2(vec3(P.xz / 25.0, P.y / 25.0)));
  alb = mix(alb, vec3(0.30, 0.28, 0.25) * (0.8 + 0.4 * fbm2(vec3(P.xz / 6.0, 2.0))), rock);

  // 溫泉所在的平台：林床（落葉與土），不畫樹冠（實際的樹在 trees.js）
  float floorM = rs(-3.0, -0.6, vH) * rs(260.0, 120.0, length(P.xz));
  vec3 floorC = mix(vec3(0.16, 0.10, 0.06), vec3(0.30, 0.15, 0.07), fbm2(vec3(P.xz / 1.7, 4.0)));
  alb = mix(alb, floorC, floorM);
  nL = normalize(mix(nL, N, floorM));

  // 聚落：灰白、藍灰、紅褐的屋頂與其間的庭木
  float town = townMask(P.xz) * rs(0.7, 0.9, N.y) * rs(55.0, 15.0, h) * step(0.0, h);
  float townLit = 0.0;
  if (town > 0.01) {
    vec2 bq = P.xz / 9.0; vec2 bc = floor(bq), bf = fract(bq);
    float bh = hash21(bc + 7.0), dens = town * (0.35 + 0.55 * fbm2(vec3(P.xz / 70.0, 9.0)));
    float bld = step(bh, dens) * rs(0.48, 0.38, max(abs(bf.x - 0.5), abs(bf.y - 0.5)));
    float k = fract(bh * 53.1);
    vec3 roof = k < 0.35 ? vec3(0.55, 0.56, 0.56) : k < 0.55 ? vec3(0.27, 0.31, 0.36) : k < 0.8 ? vec3(0.78, 0.77, 0.73) : vec3(0.42, 0.26, 0.19);
    vec3 ground = mix(vec3(0.20, 0.24, 0.14), vec3(0.42, 0.41, 0.38), 0.4);
    vec3 tc = mix(mix(ground, roof, bld), mix(ground, vec3(0.55, 0.54, 0.52), dens * 0.6), rs(0.3, 1.2, px / 9.0));
    alb = mix(alb, tc, town);
    nL = normalize(mix(nL, N, town));
    townLit = town * dens;
  }
  // 海岸：一圈淺色的岩石與護岸
  float shore = rs(3.0 + px * 0.8, 0.0, hc) * (1.0 - water);
  alb = mix(alb, vec3(0.50, 0.48, 0.44), shore * 0.85);

  float sunT = max(dot(nL, L), 0.0);
  vec3 irr = uSunCol * uSunI * sunT + mix(uHemiGround, uHemiSky, nL.y * 0.5 + 0.5) * uHemiI;
  vec3 land = alb * irr / PI;
  // 夜晚：星光。面向天空的坡帶一點藍灰，陡的稜線邊緣再亮一點點，山才不是一片死黑
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 6.0) * rs(0.85, 0.5, N.y);
  land += uNight * (vec3(0.0035, 0.005, 0.009) * (0.4 + 0.6 * N.y) + vec3(0.006, 0.009, 0.016) * rim);
  // 夜晚聚落地面被燈照亮的暖色
  land += uLit * townLit * vec3(1.0, 0.62, 0.3) * 0.035;

  // ---------- 海面 ----------
  // 波紋：遠處的格子比像素還小就淡掉，免得閃爍
  float ws = rs(3.0, 0.4, px);
  vec2 wp = P.xz * 0.12 + vec2(uTime * 0.05, uTime * 0.03);
  vec3 wn = normalize(vec3((vnoise(vec3(wp, 1.0)) - 0.5) * 0.25 * ws, 1.0, (vnoise(vec3(wp.yx * 1.3, 4.0)) - 0.5) * 0.25 * ws));
  // 風吹過的區塊：海面有亮有暗的大片紋理
  float streak = fbm2(vec3(P.x / 900.0, P.z / 260.0, 2.0));
  vec3 R = reflect(-V, wn);
  vec3 sky = skyAt(vec3(R.x, abs(R.y), R.z));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
  fres *= 0.8 + 0.35 * streak;
  vec3 body = uHemiSky * uHemiI * vec3(0.03, 0.09, 0.14);
  // 對岸的山的倒影：暗、帶一點林色
  vec3 hillRefl = (avg * 0.6) * (uHemiSky * uHemiI * 0.35 + uSunCol * uSunI * 0.12) / PI;
  vec3 refl = mix(sky, hillRefl, clamp(vRefl, 0.0, 1.0) * 0.9);
  vec3 sea = mix(body, refl, clamp(fres, 0.0, 1.0));
  // 夜晚的海映著星空，比陸地亮一點
  sea += uNight * vec3(0.006, 0.011, 0.022) * (0.5 + fres) * (1.0 - vRefl * 0.8);
  float sg = pow(max(dot(R, L), 0.0), 300.0) * uSunI * (1.0 - uNight);
  sea += uSunCol * sg * 2.0;

  vec3 col = mix(land, sea, water);

  // ---------- 空氣遠近：越遠越淡、越藍；低處（海面附近）的靄比較濃 ----------
  float dens = (1.0 / 11000.0) * (1.0 + 1.0 * exp(-max(P.y - SEA, 0.0) / 80.0));
  float hz = 1.0 - exp(-dist * dens);
  hz = max(hz, rs(8500.0, 11800.0, dist));
  vec3 hcol = mix(mix(uHaze, uSkyTop, 0.32 * (1.0 - uNight)), uSkyHorizon, rs(3000.0, 10000.0, dist));
  col = mix(col, hcol, hz);

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
const lightVert = /* glsl */ `
attribute vec3 aCol; attribute vec3 aFx; // aFx：亮度、相位、是否在海面拉出倒影
uniform float uLit, uPx, uTime;
varying vec3 vC; varying float vA;
void main(){
  vec4 mv = viewMatrix * vec4(position, 1.0);
  float d = -mv.z;
  // 遠處的燈因空氣擾動微微閃爍；紅色航空障礙燈慢慢明滅
  float tw = 0.82 + 0.18 * sin(uTime * (1.5 + aFx.y * 5.0) + aFx.y * 40.0);
  if (aCol.g < 0.2) tw = 0.15 + 0.85 * step(0.5, fract(uTime * 0.5 + aFx.y));
  vA = aFx.x * uLit * tw * exp(-d / 9000.0);
  vC = aCol;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (2.2 + 3.4 * aFx.x) * clamp(1800.0 / d, 0.7, 1.8);
}`;
const lightFrag = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float a = (exp(-r * 9.0) + exp(-r * 2.5) * 0.18) * vA;
  gl_FragColor = vec4(vC * a * 2.2, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// 海面上的倒影：燈對海面的鏡像點，沿視線落在海面上的位置，拉成一條上下抖動的光條
const streakVert = /* glsl */ `
attribute vec3 aCol; attribute vec3 aFx;
uniform float uLit, uPx, uTime;
varying vec3 vC; varying float vA; varying float vSize; varying float vPh;
void main(){
  vec3 m = vec3(position.x, 2.0 * ${SEA.toFixed(1)} - position.y, position.z);
  vec3 c = cameraPosition;
  float t = (c.y - ${SEA.toFixed(1)}) / max(c.y - m.y, 0.01);
  vec3 w = c + (m - c) * t;
  w.y = ${(SEA + 0.4).toFixed(1)};
  vec4 mv = viewMatrix * vec4(w, 1.0);
  float d = -mv.z;
  vA = aFx.z * aFx.x * uLit * exp(-d / 8000.0);
  vC = aCol; vPh = aFx.y;
  gl_Position = projectionMatrix * mv;
  vSize = uPx * (12.0 + 30.0 * aFx.x) * clamp(1500.0 / d, 0.45, 1.4);
  gl_PointSize = aFx.z > 0.5 ? vSize : 0.0;
}`;
const streakFrag = /* glsl */ `
uniform float uTime, uPx;
varying vec3 vC; varying float vA; varying float vSize; varying float vPh;
void main(){
  vec2 uv = gl_PointCoord;
  float gx = (uv.x - 0.5) * vSize / (1.1 * uPx);
  float line = exp(-gx * gx);
  float y = uv.y - 0.38; // 光條大多落在燈的下方（靠近觀看者那側）
  float prof = exp(-y * y / (y < 0.0 ? 0.012 : 0.07));
  float dash = 0.45 + 0.55 * sin(uv.y * vSize * 0.55 / uPx + uTime * 2.2 + vPh * 30.0);
  float a = line * prof * max(dash, 0.0) * vA;
  gl_FragColor = vec4(vC * a * 1.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const LCOL = {
  warm: [1.0, 0.8, 0.52], sodium: [1.0, 0.56, 0.2], white: [0.92, 0.93, 0.95], cool: [0.75, 0.86, 1.0], red: [1.0, 0.12, 0.08], green: [0.4, 1.0, 0.6],
};
function pickCol(r) { return r < 0.45 ? LCOL.warm : r < 0.72 ? LCOL.sodium : r < 0.9 ? LCOL.white : LCOL.cool; }

function buildLights(radii, H, W, cos, sin, rand) {
  const pos = [], col = [], fx = [];
  const add = (x, y, z, c, i, refl) => { pos.push(x, y, z); col.push(...c); fx.push(i, rand(), refl ? 1 : 0); };
  const slopeAt = (x, z, h) => Math.hypot(heightAt(x + 5, z) - h, heightAt(x, z + 5) - h) / 5;
  const townNear = (x, z) => { let m = 0; for (const [tx, tz, tr, td] of TOWNS) m = Math.max(m, td * Math.max(0, 1 - Math.hypot(x - tx, z - tz) / (tr * 1.9))); return m; };

  // 1) 聚落：半徑內隨機撒點，只留在海岸附近、離海面不高的緩坡
  for (const [tx, tz, tr, td] of TOWNS) {
    const n = Math.round(tr * tr * td / 260);
    for (let k = 0, placed = 0; k < n * 4 && placed < n; k++) {
      const a = rand() * Math.PI * 2, rr = tr * Math.sqrt(rand());
      const x = tx + Math.cos(a) * rr, z = tz + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h < SEA + 1 || h > SEA + 50 || slopeAt(x, z, h) > 0.32) continue;
      if (rand() > 1 - (rr / tr) ** 2 * 0.6) continue;
      placed++;
      const big = rand() < 0.06; // 偶爾有較亮的（大樓、加油站、港口照明）
      add(x, h + 3 + rand() * 7, z, big ? LCOL.white : pickCol(rand()), big ? 0.9 + rand() * 0.4 : 0.25 + rand() * 0.45, h < SEA + 14);
    }
  }
  // 2) 沿岸的道路與零星人家：沿網格的每條放射線找出跨過海岸的位置
  const NA_ = W - 1;
  for (let j = 0; j < NA_; j++) {
    for (let i = 8; i < radii.length - 1; i++) {
      const h0 = H[i * W + j], h1 = H[(i + 1) * W + j], c = SEA + 3;
      if ((h0 - c) * (h1 - c) > 0) continue;
      const t = (c - h0) / (h1 - h0), r = radii[i] + (radii[i + 1] - radii[i]) * t;
      if (r > 9000) continue;
      // 往陸地那側退幾公尺
      const back = (h1 > h0 ? 1 : -1) * 7, x = cos[j] * (r + back), z = sin[j] * (r + back);
      const spacing = (2 * Math.PI * r) / NA_;
      const p = (0.05 + 0.75 * Math.min(1, townNear(x, z) * 1.6)) * Math.min(1, spacing / 32);
      if (rand() > p) continue;
      add(x, SEA + 5 + rand() * 2, z, rand() < 0.65 ? LCOL.sodium : pickCol(rand()), 0.35 + rand() * 0.35, true);
    }
  }
  // 3) 灣裡的船
  for (const [x, z] of [[320, -930], [-560, -2650], [980, -3050], [-150, -5300], [-1250, -1350], [1700, -1500], [150, -2300]]) {
    add(x, SEA + 4, z, LCOL.white, 0.7, true);
    add(x + 6, SEA + 3, z + 2, rand() < 0.5 ? LCOL.green : LCOL.warm, 0.4, true);
  }
  // 4) 遠方山頂的航空障礙燈
  for (const [x, z] of [[-2900, -900], [3100, -3500], [-5000, -3500]]) add(x, heightAt(x, z) + 30, z, LCOL.red, 0.8, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFx', new THREE.Float32BufferAttribute(fx, 3));
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
  const lgeo = buildLights(radii, H, W, cos, sin, rand);
  const lu = { uLit: uniforms.uLit, uTime: G.uTime, uPx: { value: Math.min(devicePixelRatio, 2) } };
  const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
  const lightPts = new THREE.Points(lgeo, new THREE.ShaderMaterial({ uniforms: lu, vertexShader: lightVert, fragmentShader: lightFrag, ...add }));
  const streaks = new THREE.Points(lgeo, new THREE.ShaderMaterial({ uniforms: lu, vertexShader: streakVert, fragmentShader: streakFrag, ...add }));
  lightPts.frustumCulled = streaks.frustumCulled = false;
  scene.add(lightPts, streaks);

  return {
    terrain, uniforms, lights: lightPts, streaks, lightCount: lgeo.attributes.position.count,
    heightAt,
    update() {
      uniforms.uSunCol.value.copy(sun.color);
      uniforms.uSunI.value = sun.intensity;
      uniforms.uHemiSky.value.copy(hemi.color);
      uniforms.uHemiGround.value.copy(hemi.groundColor);
      uniforms.uHemiI.value = hemi.intensity;
      uniforms.uLit.value = Math.min(1, Math.max(0, (G.night.value - 0.3) / 0.5));
      lightPts.visible = streaks.visible = uniforms.uLit.value > 0;
    },
  };
}
