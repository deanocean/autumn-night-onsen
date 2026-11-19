// 把 layout.js 的平面圖蓋成實際的場景：地形、岩石、湯屋（道後溫泉本館的骨架，融合老湯宿的配色）、東屋、望景台、竹垣。
// 樹在 trees.js；燈籠與小物在 props.js。
import * as THREE from 'three';
import * as L from './layout.js';
import { patch } from './shaders.js';
import { G } from './env.js';
import { shojiTextures } from './shoji.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const std = (o = {}) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, ...o });

const M = {
  rock: patch(std({ color: 0xe6e2dc }), 'ROCK'),
  ground: patch(std(), 'GROUND'),
  basin: patch(std({ side: THREE.DoubleSide }), 'BASIN'),
  stone: patch(std({ color: 0x9a968e }), 'STONE'),
  roof: patch(std(), 'ROOF'),
  plaster: patch(std({ color: 0xe9e2d3 }), 'PLASTER'),
  bamboo: patch(std(), 'BAMBOO'),
  paper: std({ color: 0xf3e3c2, emissive: 0xffc27a, emissiveIntensity: 0.12, roughness: 1 }),
  dark: std({ color: 0x0c0a09, roughness: 1 }),
  // 湯屋：本瓦（屋面，瓦片座標來自頂點屬性 aTile）、棟與鬼瓦、銅的雨樋、雨鏈
  kawara: patch(std(), 'KAWARA', { TILE_ATTR: 1 }),
  tile: std({ color: new THREE.Color().setRGB(0.1, 0.11, 0.13), roughness: 0.5 }),
  copper: std({ color: 0x9c5d3c, roughness: 0.45, metalness: 0.55 }),
  // 緑青：長了銅綠的銅板屋面（唐破風、望樓；與 KAWARA 一樣用 aTile）與同色的棟、飾件
  rokusho: patch(std({ metalness: 0.15 }), 'ROKUSHO', { TILE_ATTR: 1 }),
  patina: patch(std({ metalness: 0.15 }), 'ROKUSHO'),
  chain: std({ color: 0x4a5a50, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
};
export const MATERIALS = M;

const woodCache = new Map();
// color：木色；grain：木紋走向（0=x,1=y,2=z）；plank：木板寬度（公尺，可省略）；weather：風化程度
export function wood(color, grain = 0, plank = 0, weather = 0.45, plankY = false) {
  const key = `${color}|${grain}|${plank}|${weather}|${plankY}`;
  if (!woodCache.has(key)) {
    const defs = { GRAIN: grain, WEATHER: weather.toFixed(2) };
    if (plank) defs.PLANK = plank.toFixed(3);
    if (plankY) defs.PLANKY = 1;
    woodCache.set(key, patch(std({ color }), 'WOOD', defs));
  }
  return woodCache.get(key);
}
const CEDAR = 0x7a5740, CEDAR_DARK = 0x5c4433, HINOKI = 0xb08a5c, BOARD = 0x8a6646;
const DECK_WOOD = 0x6f5d4c; // 望景台：日曬雨淋後褪成灰褐的木板
const SHU = 0xb5351f;        // 二樓高欄的朱紅
// 窗紙與提燈的夜晚亮度（每畫一次都會讀，開發者面板可即時調）
export const LOOK = {
  SHOJI_NIGHT: 0.95,  // 夜晚窗紙透光的亮度（相對於燈籠的和紙）
  SHOJI_ALBEDO: 0.2,  // 夜晚窗紙反光的比例（1 = 和白天一樣白）
  UPPER_GLOW: 0.7,    // 二樓與望樓的窗夜晚相對於下層的亮度（太亮會被色調映射洗成白色，暖色出不來）
  EAVE_LAMP: 0.6,     // 二樓簷下那排小提燈的亮度（相對於燈籠的和紙）
};

function mesh(g, geo, m, x, y, z, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadow; o.receiveShadow = true;
  g.add(o);
  return o;
}
const box = (g, w, h, d, x, y, z, m) => mesh(g, new THREE.BoxGeometry(w, h, d), m, x, y, z);
// 木料：木紋自動沿最長邊
function wbox(g, w, h, d, x, y, z, color = CEDAR_DARK, o = {}) {
  const grain = o.grain ?? (w >= h && w >= d ? 0 : h >= d ? 1 : 2);
  return box(g, w, h, d, x, y, z, wood(color, grain, o.plank || 0, o.weather ?? 0.45, !!o.plankY));
}
const cyl = (g, r0, r1, h, x, y, z, m, seg = 12) => mesh(g, new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y, z);

// 把一批沒有旋轉的零件依材質合併成少數幾個 mesh 再放進場景（欄杆、足湯這類零件很多的靜態物件用；
// 每個 mesh 在主畫面、陰影、水面倒影各要畫一次，零件一多就拖慢）。木紋是照物件座標畫的，平移不影響走向。
function bake(parent, g) {
  g.updateMatrixWorld(true);
  const by = new Map();
  g.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    if (!by.has(o.material)) by.set(o.material, []);
    by.get(o.material).push(geo);
  });
  for (const [m, list] of by) {
    const o = new THREE.Mesh(mergeGeometries(list), m);
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
  }
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// --- JS 版的雜訊，用來捏岩石的形狀 ---
const h3 = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h3(ix, iy, iz), h3(ix + 1, iy, iz), fx), l(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), fx), fy),
           l(l(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), fx), l(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
export const fbm = (x, y, z) => 0.5 * vnoise(x, y, z) + 0.25 * vnoise(x * 2.1 + 3, y * 2.1 + 7, z * 2.1 + 1) + 0.125 * vnoise(x * 4.3 + 9, y * 4.3 + 2, z * 4.3 + 5);

// 岩石：球體先用雜訊推出起伏，再用幾個隨機平面「削」出稜角
export function rockGeometry(rand, detail = 28) {
  detail = Math.round(detail * 1.5);
  const geo = new THREE.SphereGeometry(1, detail, Math.round(detail * 0.7));
  const p = geo.attributes.position;
  const sx = rand() * 50, sy = rand() * 50, sz = rand() * 50;
  const planes = [];
  const cuts = 9 + Math.floor(rand() * 5);
  for (let i = 0; i < cuts; i++) {
    const v = new THREE.Vector3(rand() - 0.5, (rand() - 0.3) * 0.9, rand() - 0.5).normalize();
    planes.push([v, 0.56 + rand() * 0.3]);
  }
  planes.push([new THREE.Vector3((rand() - 0.5) * 0.3, 1, (rand() - 0.5) * 0.3).normalize(), 0.62 + rand() * 0.25]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let r = 0.92 + 0.3 * fbm(v.x * 1.3 + sx, v.y * 1.3 + sy, v.z * 1.3 + sz);
    for (const [n, d] of planes) {
      const k = v.dot(n);
      if (k > 0.05) r = Math.min(r, d / k);
    }
    r += (fbm(v.x * 4 + sx, v.y * 4 + sy, v.z * 4 + sz) - 0.44) * 0.07;
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  geo.computeVertexNormals();
  return geo;
}

function rock(g, rand, x, z, r, h, baseY, detail) {
  const o = mesh(g, rockGeometry(rand, detail), M.rock, x, baseY + h * 0.32, z);
  o.scale.set(r * 1.08, h, r * (0.9 + rand() * 0.3));
  o.rotation.y = rand() * Math.PI * 2;
  return o;
}

// 鳥瞰時要隱藏的東西（東屋與簷廊下屋的屋頂、樹冠、野点傘；湯屋大屋頂不藏）
export const OVERHEAD = [];

// 一片屋面：杮葺、底下的野地板與一根根垂木。side 表示簷口在本地座標的哪一端
function roofSlope(g, cx, y, z, len, sl, side, ang, color) {
  const s = new THREE.Group(), tmp = new THREE.Group();
  s.position.set(cx, y, z);
  s.rotation.x = side * ang;
  g.add(s);
  OVERHEAD.push(s);
  box(tmp, len, 0.09, sl + 0.12, 0, 0.02, 0, M.roof);
  wbox(tmp, len - 0.04, 0.025, sl, 0, -0.04, 0, BOARD, { grain: 0, plank: 0.16, weather: 0.25 });
  for (let x = -len / 2 + 0.2; x <= len / 2 - 0.15; x += 0.46) wbox(tmp, 0.055, 0.085, sl + 0.06, x, -0.095, 0, color, { grain: 2 });
  wbox(tmp, len, 0.12, 0.045, 0, -0.03, side * (sl / 2 + 0.05), color); // 鼻隱板
  bake(s, tmp); // 垂木一根根都是零件，合併成少數幾個 mesh
  return s;
}

// 山形屋頂：屋脊沿 x
function gable(g, { x0, x1, zc, half, eaveY, ridgeY, over = 0.5, color = CEDAR }) {
  const len = x1 - x0 + over * 2, cx = (x0 + x1) / 2;
  const rise = ridgeY - eaveY, sl = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  for (const side of [-1, 1]) roofSlope(g, cx, (eaveY + ridgeY) / 2, zc + (side * half) / 2, len, sl, side, ang, color);
  OVERHEAD.push(wbox(g, len + 0.1, 0.11, 0.34, cx, ridgeY + 0.07, zc, CEDAR_DARK)); // 棟木
}

// 單斜的下屋（庇）：高的一端靠牆（zTop），簷口朝 -z
function pent(g, { x0, x1, zTop, yTop, zEave, yEave, over = 0.4, color = CEDAR }) {
  const run = zTop - zEave, rise = yTop - yEave;
  roofSlope(g, (x0 + x1) / 2, (yTop + yEave) / 2, (zTop + zEave) / 2, x1 - x0 + over * 2, Math.hypot(run, rise), -1, Math.atan2(rise, run), color);
}

// ---------- 湯屋（道後溫泉本館風格）用的幾何工具 ----------
const P3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = P3(0, 1, 0);
const KP = 0.27;          // 本瓦的列距（與 shaders.js 的 KAWARA 相同）

// 依材質收集幾何（可以是旋轉過的），最後各合併成一個 mesh
function collector() {
  const by = new Map();
  return {
    add(m, geo, matrix) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (matrix) g.applyMatrix4(matrix);
      if (!by.has(m)) by.set(m, []);
      by.get(m).push(g);
      return g;
    },
    flush(parent) {
      for (const [m, list] of by) {
        const o = new THREE.Mesh(mergeGeometries(list), m);
        o.castShadow = o.receiveShadow = true;
        parent.add(o);
      }
      by.clear();
    },
  };
}
// 兩點之間的方條（高度方向盡量朝上）與圓條
function barGeo(a, b, w, h) {
  const g = new THREE.BoxGeometry(w, h, a.distanceTo(b));
  return g.applyMatrix4(new THREE.Matrix4().lookAt(a, b, UP).setPosition(a.clone().add(b).multiplyScalar(0.5)));
}
function rodGeo(a, b, r, seg = 8) {
  const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, P3(1, 1, 1)));
}
const boxGeo = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// 一片斜屋面的座標系：pts 是同一平面上的多邊形頂點（世界座標，前三點不可共線）。
// u 沿簷口、v 沿屋面往下、n 朝上；o 是最高的那一點；uv 是各頂點在這個座標系裡的位置
function frame(pts) {
  const n = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
  if (n.y < 0) n.negate();
  const v = P3(0, -1, 0).addScaledVector(n, n.y).normalize();
  const u = n.clone().cross(v);
  const o = pts.reduce((a, b) => (b.y > a.y ? b : a)).clone();
  const m = new THREE.Matrix4().makeBasis(u, n, v).setPosition(o);
  const uv = pts.map((p) => { const d = p.clone().sub(o); return [d.dot(u), d.dot(v)]; });
  return { o, u, n, v, m, uv };
}
// (u, v) 多邊形擠出成厚 t 的板：頂面在 y = 0，往下長
function slabGeo(uv, t) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(uv.map(([a, b]) => new THREE.Vector2(a, b))), { depth: t, bevelEnabled: false });
  return g.rotateX(Math.PI / 2);
}
// 給本瓦 shader 的瓦片座標（沿簷口、0、沿屋面往下）；fn 省略時直接用頂點位置
function tileAttr(g, fn) {
  const p = g.attributes.position, a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const [u, v] = fn ? fn(i) : [p.getX(i), p.getZ(i)];
    a[i * 3] = u; a[i * 3 + 2] = v;
  }
  g.setAttribute('aTile', new THREE.BufferAttribute(a, 3));
  return g;
}
// 一片本瓦屋面；eaves 是簷口的線段（[起點, 終點]），沿線在每一列丸瓦的末端放一顆軒丸瓦
function tilePlane(c, pts, eaves = []) {
  const f = frame(pts);
  c.add(M.kawara, tileAttr(slabGeo(f.uv, 0.09)), f.m);
  for (const [a, b] of eaves) {
    const ua = a.clone().sub(f.o).dot(f.u), ub = b.clone().sub(f.o).dot(f.u), va = a.clone().sub(f.o).dot(f.v);
    for (let k = Math.ceil(Math.min(ua, ub) / KP - 0.3); (k + 0.5) * KP < Math.max(ua, ub) - 0.08; k++) {
      const u = (k + 0.5) * KP;
      const g = new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10).toNonIndexed().rotateX(Math.PI / 2).translate(u, -0.012, va - 0.05);
      c.add(M.kawara, tileAttr(g, () => [u, va]), f.m);
    }
  }
}
// 一片緑青銅板的屋面（pts 同 tilePlane）
function sheetPlane(c, pts) {
  const f = frame(pts);
  c.add(M.rokusho, tileAttr(slabGeo(f.uv, 0.05)), f.m);
}
// 屋簷底下看得到的部分：野地板、一根根垂木、鼻隱板。pts 是簷口附近那一條（與屋面同一平面）
function underside(parent, pts, color) {
  const f = frame(pts), s = new THREE.Group(), tmp = new THREE.Group();
  s.applyMatrix4(f.m);
  parent.add(s);
  mesh(tmp, slabGeo(f.uv, 0.025), wood(BOARD, 0, 0.16, 0.25), 0, -0.09, 0);
  const us = f.uv.map((q) => q[0]), vmax = Math.max(...f.uv.map((q) => q[1]));
  const span = (u) => {
    const vs = [];
    f.uv.forEach((p, i) => {
      const q = f.uv[(i + 1) % f.uv.length];
      if (p[0] !== q[0] && (p[0] - u) * (q[0] - u) <= 0) vs.push(p[1] + ((u - p[0]) / (q[0] - p[0])) * (q[1] - p[1]));
    });
    return [Math.min(...vs), Math.max(...vs)];
  };
  for (let u = Math.ceil((Math.min(...us) + 0.15) / 0.46) * 0.46; u < Math.max(...us) - 0.12; u += 0.46) {
    const [v0, v1] = span(u);
    if (v1 - v0 > 0.2) wbox(tmp, 0.055, 0.085, v1 - v0, u, -0.158, (v0 + v1) / 2, color, { grain: 2 });
  }
  const e = f.uv.filter((q) => q[1] > vmax - 0.01).map((q) => q[0]);
  wbox(tmp, Math.max(...e) - Math.min(...e), 0.1, 0.045, (Math.max(...e) + Math.min(...e)) / 2, -0.14, vmax - 0.03, color);
  bake(s, tmp);
}
// 鬼瓦：蓋住棟的端面的一片山形瓦板（直線的輪廓，下端兩角有往外翹的鰭），邊緣一圈凸框、中央一個圓紋；
// 頂上橫一支圓筒（鳥衾），接著棟上的丸瓦往前伸出一點。
// 面向 +z，底邊中央在原點，背面在 z = 0（貼著棟的端面）；s = 1 時高 0.42
function oniGeo(s = 1) {
  const outline = (k, fin) => {
    const sh = new THREE.Shape();
    const pts = fin
      ? [[0.3, 0], [0.4, 0.005], [0.44, 0.085], [0.37, 0.06], [0.3, 0.1], [0.27, 0.24], [0, 0.42]]
      : [[0.3, 0], [0.27, 0.24], [0, 0.42]];
    sh.moveTo(-pts[0][0] * k, 0);
    for (const q of pts) sh.lineTo(q[0] * k, q[1] * k);
    for (let i = pts.length - 2; i >= 1; i--) sh.lineTo(-pts[i][0] * k, pts[i][1] * k);
    sh.closePath();
    return sh;
  };
  const plate = new THREE.ExtrudeGeometry(outline(1, true), { depth: 0.06, bevelEnabled: false });
  const rim = outline(1, false);
  rim.holes.push(outline(0.78, false).getPoints().map((q) => new THREE.Vector2(q.x, q.y + 0.04)).reduce((path, q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y), path), new THREE.Path()));
  const frame = new THREE.ExtrudeGeometry(rim, { depth: 0.025, bevelEnabled: false }).translate(0, 0, 0.06);
  const crest = new THREE.CylinderGeometry(0.07, 0.07, 0.02, 20).rotateX(Math.PI / 2).translate(0, 0.17, 0.07);
  const roll = new THREE.CylinderGeometry(0.052, 0.052, 0.22, 14).rotateX(Math.PI / 2).translate(0, 0.44, 0.04);
  return mergeGeometries([plate, frame, crest, roll].map((g) => g.toNonIndexed())).scale(s, s, s);
}
// 懸魚：破風頂點垂下的木雕（面向 +z，頂端在原點）
function gegyoGeo(s = 1, fins = false) {
  const g = new THREE.Shape();
  g.moveTo(0, 0.12); g.lineTo(0.13, 0.02); g.quadraticCurveTo(0.2, -0.16, 0, -0.34); g.quadraticCurveTo(-0.2, -0.16, -0.13, 0.02); g.closePath();
  const parts = [new THREE.ExtrudeGeometry(g, { depth: 0.04, bevelEnabled: false })];
  // 鰭：兩旁往外伸的捲葉（唐破風的兎毛通用）
  if (fins) for (const k of [-1, 1]) {
    const f = new THREE.Shape();
    f.moveTo(k * 0.1, 0.06); f.quadraticCurveTo(k * 0.34, 0.12, k * 0.56, -0.04); f.quadraticCurveTo(k * 0.6, -0.1, k * 0.52, -0.12);
    f.quadraticCurveTo(k * 0.34, -0.02, k * 0.13, -0.1); f.closePath();
    parts.push(new THREE.ExtrudeGeometry(f, { depth: 0.03, bevelEnabled: false }));
  }
  return mergeGeometries(parts.map((q) => q.toNonIndexed())).translate(0, -0.12, 0).scale(s, s, 1);
}
// 蟇股：蛙腳形的木雕（面向 ±z，底邊中央在原點，w 寬、h 高），上面頂一個斗，挖空處有一朵雕花
function kaerumataGeo(w, h) {
  const s = new THREE.Shape(), a = w / 2;
  s.moveTo(-a * 0.24, h);
  s.lineTo(a * 0.24, h);
  s.bezierCurveTo(a * 0.3, h * 0.45, a * 0.78, h * 0.3, a, h * 0.06); // 外緣：往下張開的腳
  s.quadraticCurveTo(a * 1.02, 0, a * 0.94, 0);
  s.lineTo(a * 0.7, 0);
  s.bezierCurveTo(a * 0.62, h * 0.32, a * 0.28, h * 0.6, 0, h * 0.64); // 內緣：腳與腳之間的拱
  s.bezierCurveTo(-a * 0.28, h * 0.6, -a * 0.62, h * 0.32, -a * 0.7, 0);
  s.lineTo(-a * 0.94, 0);
  s.quadraticCurveTo(-a * 1.02, 0, -a, h * 0.06);
  s.bezierCurveTo(-a * 0.78, h * 0.3, -a * 0.3, h * 0.45, -a * 0.24, h);
  const body = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 }).translate(0, 0, -0.035);
  // 雕花：兩片往外捲的葉子夾著中央的花苞，退在本體後面一點
  const leaf = (k) => {
    const l = new THREE.Shape();
    l.moveTo(0, 0); l.quadraticCurveTo(k * a * 0.36, h * 0.0, k * a * 0.52, h * 0.36); l.quadraticCurveTo(k * a * 0.24, h * 0.38, 0, h * 0.18); l.closePath();
    return new THREE.ExtrudeGeometry(l, { depth: 0.04, bevelEnabled: false }).translate(0, h * 0.04, -0.02).toNonIndexed();
  };
  return mergeGeometries([
    body.toNonIndexed(), leaf(1), leaf(-1),
    new THREE.SphereGeometry(h * 0.19, 10, 8).scale(0.8, 1.25, 0.55).translate(0, h * 0.33, 0).toNonIndexed(),
    new THREE.BoxGeometry(a * 0.62, 0.075, 0.12).translate(0, h + 0.0375, 0).toNonIndexed(), // 斗
  ]);
}
// 妻飾：三角的白壁、木連格子、破風板、懸魚。在本地座標面向 +z（頂點在 x = 0），m 把它擺到世界裡。
// yb 是底邊、ya 是屋面在頂點的高度、q 是屋面的斜率；破風板貼在屋面的瓦底下，往前挑出 over。
// grain 是破風板的木紋方向（擺好之後的世界軸：面向 z 的用 0、面向 x 的用 2）
function gableFace(c, m, { yb, ya, q, over, grain }) {
  const top = ya - 0.1, hw = (top - yb) / q, dark = wood(CEDAR_DARK, 1);
  const tri = new THREE.Shape();
  tri.moveTo(-hw, yb); tri.lineTo(hw, yb); tri.lineTo(0, top); tri.closePath();
  c.add(M.plaster, new THREE.ShapeGeometry(tri), m);
  for (let x = -hw + 0.24; x < hw - 0.2; x += 0.17) {
    const t = top - Math.abs(x) * q - 0.1;
    if (t - yb > 0.12) c.add(dark, boxGeo(0.045, t - yb, 0.04, x, (t + yb) / 2, 0.03), m);
  }
  c.add(wood(CEDAR_DARK, grain), boxGeo(hw * 2, 0.12, 0.07, 0, yb + 0.06, 0.05), m);
  const xe = (ya - yb) / q + 0.3, bh = 0.24;
  for (const sd of [-1, 1]) {
    const b = new THREE.Shape();
    b.moveTo(0, top); b.lineTo(sd * xe, top - xe * q); b.lineTo(sd * xe, top - xe * q - bh); b.lineTo(0, top - bh); b.closePath();
    c.add(wood(CEDAR_DARK, grain), new THREE.ExtrudeGeometry(b, { depth: 0.06, bevelEnabled: false }).translate(0, 0, over), m);
  }
  c.add(dark, gegyoGeo(Math.min(1.3, 0.55 + hw * 0.3)).translate(0, top - 0.22, over + 0.06), m);
}
// 面向 -z（正面）、-x（西）、+x（東）的擺放矩陣
const faceM = (dir, x, z) => new THREE.Matrix4().makeRotationY(dir === 'n' ? Math.PI : dir === 'w' ? -Math.PI / 2 : Math.PI / 2).setPosition(x, 0, z);

function textTexture(text, { bg, fg, size = 150, w = 256, h = 256, font = '600', scale = 4 }) {
  // scale：貼圖解析度倍率（近看也要銳利）
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `${font} ${size}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif TC", serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + size * 0.05);
  // 布面織紋：很淡的橫紋與直紋（蓋在字上，字也像染進布裡）
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const step = Math.max(2, Math.round(scale * 0.75));
  for (let y = 0; y < c.height; y += step) { ctx.fillStyle = `rgba(255,255,255,${0.018 + ((y / step) % 3) * 0.008})`; ctx.fillRect(0, y, c.width, 1); }
  for (let x = 0; x < c.width; x += step) { ctx.fillStyle = `rgba(0,0,0,${0.02 + ((x / step) % 4) * 0.008})`; ctx.fillRect(x, 0, 1, c.height); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  return t;
}

// 飴釉：深褐的底，口緣一圈琥珀色的釉往下流成長短不一的條痕（u 繞壺身、v 由底到口）
function glazeTexture(rand) {
  const c = document.createElement('canvas'), w = (c.width = 2048), h = (c.height = 1024);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#6a3513'); g.addColorStop(0.1, '#4a220d'); g.addColorStop(0.45, '#33150a'); g.addColorStop(1, '#221009');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 窯變的濃淡：大塊的明暗
  for (let i = 0; i < 60; i++) {
    const x = rand() * w, y = rand() * h, r = 60 + rand() * 200;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, rand() < 0.5 ? `rgba(120,62,22,${0.1 + rand() * 0.16})` : `rgba(14,6,3,${0.12 + rand() * 0.2})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    for (const ox of [-w, 0, w]) ctx.fillRect(x - r + ox, y - r, r * 2, r * 2);
  }
  // 流釉：從口緣往下
  for (let i = 0; i < 80; i++) {
    const x = rand() * w, bw = 5 + rand() * rand() * 40, len = h * (0.08 + rand() * rand() * 0.7);
    const dg = ctx.createLinearGradient(0, 0, 0, len);
    const a = 0.2 + rand() * 0.45, warm = rand();
    dg.addColorStop(0, `rgba(${200 + warm * 30 | 0},${128 + warm * 40 | 0},${46 + warm * 30 | 0},${a})`);
    dg.addColorStop(0.7, `rgba(168,96,34,${a * 0.6})`);
    dg.addColorStop(1, 'rgba(150,80,28,0)');
    ctx.fillStyle = dg;
    for (const ox of [-w, 0, w]) {
      ctx.beginPath();
      ctx.moveTo(x + ox - bw / 2, 0); ctx.lineTo(x + ox + bw / 2, 0);
      ctx.quadraticCurveTo(x + ox + bw * 0.4, len * 0.8, x + ox, len);
      ctx.quadraticCurveTo(x + ox - bw * 0.4, len * 0.8, x + ox - bw / 2, 0);
      ctx.fill();
    }
  }
  // 口緣：釉最厚、顏色最淺的一圈；細小的鐵斑
  const rg = ctx.createLinearGradient(0, 0, 0, 70);
  rg.addColorStop(0, 'rgba(205,150,70,0.85)'); rg.addColorStop(1, 'rgba(190,120,50,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, w, 70);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rand() < 0.7 ? `rgba(16,7,3,${0.15 + rand() * 0.35})` : `rgba(225,170,90,${0.08 + rand() * 0.2})`;
    ctx.beginPath(); ctx.arc(rand() * w, rand() * h, 0.6 + rand() * 2.2, 0, 6.283); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function buildWorld(scene) {
  // 窗紙：與燈籠共用的 M.paper 分開。日間 map 是單純的和紙；夜裡的影絵畫在各窗自己的 emissiveMap（見 shoji.js）。
  const ST = shojiTextures(fbm, rng);
  // 夜間發光強度由 daynight.js 驅動 M.paper；窗紙用 getter 直接跟著它（不必改 daynight.js）
  // G.house 降到 0（場內的燈全熄）時，窗內也只剩一點餘光
  const shojiMat = (emap, gainKey = null, glow = 0xffc27a) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xf3e3c2, map: ST.plain, emissive: glow, emissiveMap: emap, emissiveIntensity: M.paper.emissiveIntensity, roughness: 1 });
    const col = m.color.clone();
    Object.defineProperty(m, 'emissiveIntensity', {
      // 夜裡窗紙略暗於燈籠（SHOJI_NIGHT）；窗前那兩盞「窗內透出的光」點光源會把白紙照到過曝，
      // 所以夜裡把紙的反光壓低（SHOJI_ALBEDO），亮度主要來自自己的透光與影絵的對比。
      // three 每畫一次都會讀這個值，順便在這裡更新顏色。
      get: () => {
        const p = M.paper.emissiveIntensity, n = G.night.value, h = G.house.value;
        m.color.copy(col).multiplyScalar(1 - (1 - LOOK.SHOJI_ALBEDO) * n);
        const gain = gainKey ? LOOK[gainKey] : 1;
        return p * (1 - (1 - LOOK.SHOJI_NIGHT) * n) * h * (1 + (gain - 1) * n) + Math.min(p, 0.12) * (1 - 0.75 * n) * (1 - h);
      },
      set() {}, configurable: true,
    });
    return m;
  };
  const SHOJI = shojiMat(ST.plain);
  const SHOJI_LOWER = { 1: shojiMat(ST.panels[0]), 2: shojiMat(ST.panels[1]), 5: shojiMat(ST.panels[2]), 6: shojiMat(ST.panels[3]) };
  const SHOJI_ROUND = shojiMat(ST.round);
  const SHOJI_UP = shojiMat(ST.plain, 'UPPER_GLOW', 0xff8c34); // 二樓與望樓：比下層更暖的琥珀色，遠看是一整排燈火
  const world = new THREE.Group();
  scene.add(world);
  const rand = rng(20261110);

  // ---------- 地面與池盆 ----------
  const N = 128;
  const rim = [];
  for (let i = 0; i < N; i++) rim.push(L.poolPoint((i / N) * Math.PI * 2));
  {
    const shape = new THREE.Shape();
    // 只鋪到竹垣外一點；再往外是 vista.js 的地形（平台高度略低 5 公分，接縫看不出來）
    shape.moveTo(-16, 12.6); shape.lineTo(16, 12.6); shape.lineTo(16, -22); shape.lineTo(-16, -22); shape.closePath();
    const hole = new THREE.Path();
    rim.forEach(([x, z], i) => (i ? hole.lineTo(x, -z) : hole.moveTo(x, -z)));
    hole.closePath();
    shape.holes.push(hole);
    const ground = mesh(world, new THREE.ShapeGeometry(shape), M.ground, 0, 0, 0, false);
    ground.rotation.x = -Math.PI / 2;

    const rings = 14, pos = [], idx = [];
    for (let r = 0; r <= rings; r++) {
      const t = 1 - (r / rings) * 0.999;
      for (let i = 0; i < N; i++) {
        const [x, z] = L.poolPoint((i / N) * Math.PI * 2, t);
        pos.push(x, L.groundY(x, z), z);
      }
    }
    for (let r = 0; r < rings; r++) for (let i = 0; i < N; i++) {
      const a = r * N + i, b = r * N + ((i + 1) % N), c = a + N, d = b + N;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    mesh(world, geo, M.basin, 0, 0, 0, false);
  }

  // ---------- 岩石 ----------
  rock(world, rand, L.CENTER_ROCK.x, L.CENTER_ROCK.z, L.CENTER_ROCK.r, L.CENTER_ROCK.h * 1.25, -0.62, 40);
  rock(world, rand, L.CENTER_ROCK.x - 1.1, L.CENTER_ROCK.z + 0.75, 0.5, 0.5, -0.6, 22);
  L.RIM_ROCKS.forEach((k) => rock(world, rand, k.x, k.z, k.r, k.h * 1.15, -0.3, 34));
  // 把池岸連成一圈的中小型石塊，石腳沒入水裡蓋住水線；三個入口處只放低矮的踏石
  const gaps = [[2.14, 0.3], [Math.PI, 0.42], [-Math.PI, 0.42], [-1.57, 0.34]];
  const inGap = (th) => gaps.some(([c, w]) => Math.abs(th - c) < w);
  for (let i = 0; i < 84; i++) {
    const th = -Math.PI + (i / 84) * Math.PI * 2 + (rand() - 0.5) * 0.04;
    const [x, z] = L.poolPoint(th, 0.985 + rand() * 0.04);
    if (L.RIM_ROCKS.some((k) => Math.hypot(k.x - x, k.z - z) < k.r * 0.85)) { rand(); rand(); continue; }
    if (inGap(th)) rock(world, rand, x, z, 0.3 + rand() * 0.14, 0.12, -0.04, 14);
    else rock(world, rand, x, z, 0.26 + rand() * 0.26, 0.2 + rand() * 0.26, -0.2, 18);
  }
  // 池畔散置的景石
  for (const [x, z, r, h] of [[-10.2, 1.4, 0.55, 0.5], [7.4, 6.6, 0.7, 0.6], [11.6, 1.2, 0.8, 0.75], [-6.6, -7.4, 0.6, 0.45], [4.6, -7.0, 0.5, 0.4], [-11.8, 8.6, 0.65, 0.5], [12.8, -10.9, 0.9, 0.8]]) {
    rock(world, rand, x, z, r, h, -0.12, 22);
  }

  // 湯口：岩堆中伸出的竹筒
  {
    const spout = cyl(world, 0.055, 0.06, 1.5, L.YUGUCHI.x + 0.74, L.YUGUCHI.y + 0.06, L.YUGUCHI.z, wood(0x9a8a4e, 1, 0, 0.2), 12);
    spout.rotation.z = Math.PI / 2 - 0.09;
  }

  // ---------- 湯屋與簷廊（道後溫泉本館風格） ----------
  // 骨架是道後溫泉本館，配色與細部融合了四万溫泉積善館等老湯宿共通的元素（6D3）。
  // 由下往上層層疊起：深簷的下屋與簷廊、入口的唐破風（緑青銅板）與蟇股、圍著朱紅高欄的二樓（簷下一排小提燈）、
  // 灰黑本瓦的入母屋大屋頂（正面前後兩層千鳥破風）、屋脊中央的小望樓（白壁、格子窗、緑青的寄棟屋頂）。
  // 不旋轉的零件收在 yg 最後依材質合併；屋頂上的東西收在 roofG。
  const lamps = []; // 簷下吊燈籠與入口提燈，交給 lights.js 做成光源
  {
    const Y = L.YUYA, E = L.ENGAWA;
    // wallTop 要低於兩端斜簷在牆面位置的高度（入母屋的簷是四面繞一圈的），否則牆頂會穿出屋面
    const zc = 13.5, half = 3.7, eaveY = 5.3, PITCH = 0.5, ridgeY = eaveY + half * PITCH, wallTop = 5.6;
    const pentTop = 3.5, pentEaveY = 2.85, pentEaveZ = 8.2;
    const w = Y.x1 - Y.x0, cx = (Y.x0 + Y.x1) / 2, fz = Y.z0;
    const DOOR = 3, ROUND = 4;
    const yg = new THREE.Group(), roofG = new THREE.Group(), rc = collector();
    world.add(roofG); // 鳥瞰時不隱藏：湯屋沒有室內，拿掉屋頂只會露出白壁盒子的頂面
    const DARK1 = wood(CEDAR_DARK, 1);

    // 牆身（白壁）與石砌基座
    M.plaster.side = THREE.DoubleSide;
    box(yg, w, wallTop - E.y, Y.z1 - Y.z0, cx, (wallTop + E.y) / 2, (Y.z0 + Y.z1) / 2, M.plaster);
    box(yg, w + 0.2, E.y, Y.z1 - Y.z0 + 0.1, cx, E.y / 2, (Y.z0 + Y.z1) / 2, M.stone);
    const bays = 8, bw = w / bays, front = fz - 0.05;
    // 通柱（從基座一路到上層桁）
    for (let i = 0; i <= bays; i++) wbox(yg, 0.18, wallTop - E.y, 0.18, Y.x0 + i * bw, (wallTop + E.y) / 2, front, CEDAR_DARK);
    wbox(yg, w, 0.14, 0.1, cx, E.y + 2.18, front - 0.04, CEDAR_DARK);   // 長押
    wbox(yg, w, 0.2, 0.14, cx, pentTop + 0.12, front - 0.04, CEDAR_DARK); // 胴差
    wbox(yg, w, 0.18, 0.14, cx, wallTop - 0.1, front - 0.04, CEDAR_DARK); // 上層桁
    // 兩側山牆：白壁上露出柱與橫木
    for (const x of [Y.x0 - 0.04, Y.x1 + 0.04]) {
      for (const z of [Y.z0 + 2.5, Y.z1 - 0.09]) wbox(yg, 0.18, wallTop - E.y, 0.18, x, (wallTop + E.y) / 2, z, CEDAR_DARK);
      for (const [y, h] of [[E.y + 0.95, 0.12], [E.y + 2.18, 0.14], [pentTop + 0.12, 0.2], [4.7, 0.12], [wallTop - 0.1, 0.18]]) wbox(yg, 0.1, h, Y.z1 - Y.z0, x, y, (Y.z0 + Y.z1) / 2, CEDAR_DARK);
    }

    // --- 下層各開間 ---
    const shoji = (bx, inner, y0, y1, cols, rows, mat = SHOJI) => {
      const hh = y1 - y0;
      box(yg, inner, hh, 0.02, bx, (y0 + y1) / 2, front + 0.03, mat);
      for (let c = 1; c < cols; c++) wbox(yg, 0.018, hh, 0.025, bx - inner / 2 + (inner * c) / cols, (y0 + y1) / 2, front, CEDAR_DARK);
      for (let r = 1; r < rows; r++) wbox(yg, inner, 0.018, 0.025, bx, y0 + (hh * r) / rows, front, CEDAR_DARK);
      wbox(yg, inner, 0.05, 0.06, bx, y0 - 0.02, front - 0.01, CEDAR_DARK);
      wbox(yg, inner, 0.05, 0.06, bx, y1 + 0.02, front - 0.01, CEDAR_DARK);
    };
    const doorX = Y.x0 + (DOOR + 0.5) * bw;
    for (let i = 0; i < bays; i++) {
      const bx = Y.x0 + (i + 0.5) * bw, inner = bw - 0.18;
      if (i === DOOR) {
        // 入口：深色的室內、踏板與暖簾
        box(yg, inner, 2.1, 0.05, bx, E.y + 1.06, front + 0.02, M.dark);
        wbox(yg, inner, 0.05, 0.3, bx, E.y + 0.025, front - 0.12, HINOKI, { weather: 0.2 });
        const cloth = new THREE.MeshStandardMaterial({ map: textTexture('湯', { bg: '#22335a', fg: '#efe6d2', scale: 6 }), roughness: 1, side: THREE.DoubleSide });
        wbox(yg, inner + 0.1, 0.035, 0.035, bx, E.y + 2.04, front - 0.1, HINOKI);
        for (let k = 0; k < 3; k++) {
          const pw = (inner - 0.1) / 3;
          const p = mesh(world, new THREE.PlaneGeometry(pw - 0.02, 0.95), cloth, bx - (inner - 0.1) / 2 + pw * (k + 0.5), E.y + 1.55, front - 0.1);
          p.rotation.y = Math.PI;
          const uv = p.geometry.attributes.uv;
          for (let j = 0; j < uv.count; j++) uv.setX(j, (2 - k + uv.getX(j)) / 3);
          p.userData.noren = k;
        }
        continue;
      }
      // 腰壁：下見板張（橫向木板一片壓一片）
      wbox(yg, inner, 0.88, 0.04, bx, E.y + 0.44, front + 0.02, CEDAR, { grain: 0, plank: 0.15, plankY: true, weather: 0.6 });
      for (const ox of [-inner / 4, inner / 4]) wbox(yg, 0.035, 0.88, 0.03, bx + ox, E.y + 0.44, front - 0.01, CEDAR_DARK); // 押縁
      if (i === ROUND) {
        // 丸窗
        const cy = E.y + 1.52, R = 0.52;
        const disc = mesh(world, new THREE.CircleGeometry(R, 40), SHOJI_ROUND, bx, cy, front - 0.005, false);
        disc.rotation.y = Math.PI;
        const ring = mesh(world, new THREE.TorusGeometry(R, 0.045, 8, 48), wood(CEDAR_DARK, 0), bx, cy, front - 0.02, false);
        ring.rotation.y = Math.PI;
        for (const t of [-0.5, 0, 0.5]) {
          const hl = Math.sqrt(1 - t * t) * R * 2;
          wbox(yg, 0.02, hl, 0.02, bx + t * R, cy, front - 0.02, CEDAR_DARK);
          wbox(yg, hl, 0.02, 0.02, bx, cy + t * R, front - 0.02, CEDAR_DARK);
        }
      } else if (i !== 0 && i !== bays - 1) {
        shoji(bx, inner, E.y + 0.95, E.y + 2.08, 7, 4, SHOJI_LOWER[i]);
      } else {
        // 兩端的開間：出格子（細密的直木格，裡面透出燈光）
        const y0 = E.y + 0.98, y1 = E.y + 2.06, lw = inner - 0.3, n = 17;
        box(yg, lw, y1 - y0, 0.02, bx, (y0 + y1) / 2, front + 0.03, SHOJI);
        for (let c = 0; c <= n; c++) wbox(yg, 0.03, y1 - y0, 0.04, bx - lw / 2 + (lw * c) / n, (y0 + y1) / 2, front - 0.04, CEDAR_DARK);
        for (const y of [y0 - 0.03, (y0 + y1) / 2, y1 + 0.03]) wbox(yg, lw + 0.1, y === (y0 + y1) / 2 ? 0.035 : 0.07, 0.07, bx, y, front - 0.03, CEDAR_DARK);
      }
    }

    // --- 上層：ガラス障子（細格的拉窗）與外面一圈高欄 ---
    const balY = pentTop + 0.2, railZ = front - 0.5, railTop = balY + 0.62;
    for (let i = 0; i < bays; i++) {
      const bx = Y.x0 + (i + 0.5) * bw, inner = bw - 0.18, y0 = balY + 0.1, y1 = wallTop - 0.42, ym = (y0 + y1) / 2;
      if (i === 0 || i === bays - 1) { wbox(yg, inner, 0.1, 0.05, bx, ym + 0.3, front + 0.01, CEDAR_DARK); continue; } // 兩端是白壁，只有一道貫
      box(yg, inner, y1 - y0, 0.02, bx, ym, front + 0.03, SHOJI_UP);
      for (let c = 1; c < 8; c++) wbox(yg, c % 2 ? 0.016 : 0.045, y1 - y0, c % 2 ? 0.025 : 0.04, bx - inner / 2 + (inner * c) / 8, ym, front, CEDAR_DARK);
      for (let r = 1; r < 5; r++) wbox(yg, inner, 0.016, 0.025, bx, y0 + ((y1 - y0) * r) / 5, front, CEDAR_DARK);
      wbox(yg, inner, 0.07, 0.09, bx, y0 - 0.03, front - 0.02, CEDAR_DARK);
      wbox(yg, inner, 0.07, 0.09, bx, y1 + 0.03, front - 0.02, CEDAR_DARK);
    }
    wbox(yg, w + 0.5, 0.045, 0.56, cx, balY, front - 0.26, BOARD, { grain: 0, plank: 0.14, weather: 0.4 }); // 縁板
    wbox(yg, w + 0.56, 0.11, 0.07, cx, balY - 0.07, railZ - 0.03, CEDAR_DARK);                              // 縁框
    for (let i = 0; i <= bays; i++) wbox(yg, 0.1, 0.12, 0.52, Y.x0 + i * bw, balY - 0.085, front - 0.27, CEDAR_DARK); // 腕木
    // 高欄漆成朱紅（縁板、縁框、腕木維持深色的木頭）
    for (let i = 0; i <= bays * 2; i++) wbox(yg, 0.06, railTop - balY, 0.06, Y.x0 + (i * bw) / 2, (railTop + balY) / 2, railZ, SHU);
    for (let x = Y.x0 + bw / 12; x < Y.x1; x += bw / 6) wbox(yg, 0.028, 0.3, 0.028, x, balY + 0.25, railZ, SHU); // 平桁與地覆之間的斗束
    wbox(yg, w + 0.9, 0.055, 0.075, cx, railTop, railZ, SHU);   // 架木（兩端伸出去）
    wbox(yg, w + 0.5, 0.045, 0.05, cx, balY + 0.4, railZ, SHU); // 平桁
    wbox(yg, w + 0.5, 0.05, 0.055, cx, balY + 0.1, railZ, SHU); // 地覆
    for (const x of [Y.x0 - 0.22, Y.x1 + 0.22]) {
      wbox(yg, 0.06, railTop - balY, 0.06, x, (railTop + balY) / 2, railZ, SHU);
      for (const [y, h] of [[railTop, 0.055], [balY + 0.4, 0.045], [balY + 0.1, 0.05]]) wbox(yg, 0.055, h, 0.62, x, y, front - 0.22, SHU);
    }

    // 簷下的一排小提燈：只有自己發光、不照亮場景（不佔點光源與燈具 uniform 的額度）；跟著窗內的光一起亮、一起暗
    {
      const lm = new THREE.MeshStandardMaterial({ color: 0xf1d2a8, emissive: 0xff8a36, roughness: 1 });
      Object.defineProperty(lm, 'emissiveIntensity', {
        get: () => 0.1 + (M.paper.emissiveIntensity - 0.12) * LOOK.EAVE_LAMP * (0.04 + 0.96 * G.house.value),
        set() {}, configurable: true,
      });
      const lz = railZ + 0.02, ly = 4.93, top = eaveY + (lz - (zc - half)) * PITCH - 0.2;
      for (let i = 0; i < bays * 2; i++) {
        const x = Y.x0 + (i + 0.5) * (bw / 2);
        rc.add(lm, new THREE.SphereGeometry(0.1, 14, 10).scale(1, 1.3, 1).translate(x, ly, lz));
        for (const dy of [0.135, -0.135]) rc.add(M.dark, new THREE.CylinderGeometry(0.052, 0.052, 0.022, 10).translate(x, ly + dy, lz));
        rc.add(M.dark, new THREE.CylinderGeometry(0.004, 0.004, top - ly - 0.14, 4).translate(x, (top + ly + 0.14) / 2, lz));
      }
    }

    // --- 簷廊 ---
    wbox(yg, E.x1 - E.x0, 0.06, E.z1 - E.z0, (E.x0 + E.x1) / 2, E.y - 0.03, (E.z0 + E.z1) / 2, HINOKI, { grain: 0, plank: 0.14, weather: 0.3 });
    wbox(yg, E.x1 - E.x0, 0.14, 0.08, (E.x0 + E.x1) / 2, E.y - 0.12, E.z0 + 0.04, CEDAR);
    for (let x = E.x0 + 0.3; x < E.x1; x += 1.7) wbox(yg, 0.1, E.y - 0.18, 0.1, x, (E.y - 0.18) / 2, E.z0 + 0.12, CEDAR_DARK);
    box(yg, E.x1 - E.x0 - 0.2, E.y - 0.2, 0.05, (E.x0 + E.x1) / 2, (E.y - 0.2) / 2, E.z0 + 0.35, M.dark);
    const pz = E.z0 + 0.25;
    const beamY = pentEaveY + ((pz - pentEaveZ) / (fz - pentEaveZ)) * (pentTop - pentEaveY) - 0.2;
    L.ENGAWA_POSTS.forEach(([x, z]) => {
      wbox(yg, 0.15, beamY - E.y, 0.15, x, (beamY + E.y) / 2, z, CEDAR_DARK);
      wbox(yg, 0.62, 0.1, 0.13, x, beamY - 0.14, z, CEDAR_DARK); // 舟肘木
      wbox(yg, 0.1, 0.13, fz - pz, x, beamY + 0.12, (fz + pz) / 2, CEDAR_DARK); // 連接柱與牆的繫樑
    });
    wbox(yg, E.x1 - E.x0 + 0.6, 0.18, 0.15, (E.x0 + E.x1) / 2, beamY, pz, CEDAR_DARK);
    const ks = mesh(world, rockGeometry(rand, 26), M.stone, E.x0 + 5, 0.02, E.z0 - 0.38);
    ks.scale.set(2.0, 0.3, 0.5);
    pent(world, { x0: E.x0, x1: E.x1, zTop: fz, yTop: pentTop, zEave: pentEaveZ, yEave: pentEaveY, over: 0.6 });

    // 釣燈籠：掛在簷下的六角鐵燈籠（和紙的燈身各自獨立，才能逐盞熄滅）
    const ps = L.ENGAWA_POSTS.map((q) => q[0]);
    for (let i = 0; i < ps.length - 1; i++) {
      const x = (ps[i] + ps[i + 1]) / 2;
      if (Math.abs(x - doorX) < 1.2) continue;
      const y = beamY - 0.44, R = 0.088;
      const pm = M.paper.clone();
      const body = mesh(world, new THREE.CylinderGeometry(R - 0.006, R - 0.006, 0.25, 6), pm, x, y, pz, false);
      for (let k = 0; k < 6; k++) box(yg, 0.013, 0.26, 0.013, x + Math.sin((k * Math.PI) / 3) * R, y, pz + Math.cos((k * Math.PI) / 3) * R, M.dark);
      for (const [dy, r0, r1, h] of [[0.135, R + 0.012, R + 0.012, 0.018], [-0.135, R + 0.012, R + 0.012, 0.018], [0.2, 0.02, R + 0.07, 0.11], [0.265, 0.014, 0.014, 0.03], [-0.16, R - 0.02, R - 0.05, 0.03]]) cyl(yg, r0, r1, h, x, y + dy, pz, M.dark, 6);
      cyl(yg, 0.005, 0.005, beamY - 0.09 - (y + 0.28), x, (beamY - 0.09 + y + 0.28) / 2, pz, M.dark, 4);
      lamps.push({ x, y, z: pz, kind: 'hanging', mat: pm, paper: body });
    }
    // 長椅與脫衣籠
    {
      const bx = 1.2, bz = E.z1 - 0.32;
      wbox(yg, 1.5, 0.05, 0.42, bx, E.y + 0.4, bz, HINOKI, { grain: 0, plank: 0.14, weather: 0.25 });
      for (const sx of [-1, 1]) wbox(yg, 0.06, 0.4, 0.36, bx + sx * 0.6, E.y + 0.2, bz, CEDAR_DARK, { grain: 1 });
      const kago = patch(std({ color: 0xb89a62 }), 'BAMBOO');
      for (const ox of [-0.35, 0.3]) {
        const k = cyl(world, 0.19, 0.15, 0.2, bx + ox, E.y + 0.53, bz, kago, 16);
        k.scale.z = 0.8;
      }
      L.boxes.push({ x0: bx - 0.75, x1: bx + 0.75, z0: bz - 0.21, z1: bz + 0.3 });
    }

    // --- 入口的唐破風：簷口在入口上方鼓起一道弧，瓦順著弧面往兩旁鋪；弧下是虹樑、蟇股與兎毛通 ---
    {
      const HW = 1.95, KH = 0.88, y0 = pentEaveY + 0.1, z0 = 7.98, z1 = 10.2, n = 32;
      const prof = (t) => y0 + KH * (0.5 + 0.5 * Math.cos(Math.PI * Math.pow(t, 0.9))) + 0.06 * Math.pow(Math.max(0, (t - 0.75) / 0.25), 2);
      const pts = [];
      for (let i = 0; i <= n; i++) { const t = (i / n) * 2 - 1; pts.push([t * HW, prof(Math.abs(t))]); }
      // 弧面：一段段的窄條，瓦片座標用弧長（從弧頂往兩旁）
      const cum = [0];
      for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const pos = [], nor = [], til = [];
      const nrm = (i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };
      const put = (i, z) => { const q = nrm(i); pos.push(doorX + pts[i][0], pts[i][1], z); nor.push(q[0], q[1], 0); til.push(z, 0, Math.abs(cum[i] - cum[n / 2])); };
      for (let i = 0; i < n; i++) { put(i, z0); put(i, z1); put(i + 1, z1); put(i, z0); put(i + 1, z1); put(i + 1, z0); }
      const sheet = new THREE.BufferGeometry();
      sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sheet.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      sheet.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
      sheet.setAttribute('aTile', new THREE.Float32BufferAttribute(til, 3));
      rc.add(M.rokusho, sheet); // 緑青銅板（6D3；原本鋪本瓦）
      // 正面沿著弧的一道捲邊、弧頂的棟與棟端的飾板（都是緑青色）
      for (let i = 0; i < n; i++) rc.add(M.patina, rodGeo(P3(doorX + pts[i][0], pts[i][1] + 0.02, z0 + 0.05), P3(doorX + pts[i + 1][0], pts[i + 1][1] + 0.02, z0 + 0.05), 0.06));
      rc.add(M.patina, barGeo(P3(doorX, y0 + KH + 0.08, z0 - 0.02), P3(doorX, y0 + KH + 0.08, z1), 0.2, 0.2));
      rc.add(M.patina, rodGeo(P3(doorX, y0 + KH + 0.19, z0 - 0.04), P3(doorX, y0 + KH + 0.19, z1), 0.075));
      rc.add(M.patina, oniGeo(0.8), faceM('n', doorX, 0).setPosition(doorX, y0 + KH - 0.04, z0 - 0.02));
      // 破風板（跟著弧線的厚板）、弧下的板壁、背面的封板
      const band = (drop0, drop1) => {
        const s = new THREE.Shape();
        pts.forEach(([x, y], i) => (i ? s.lineTo(x, y - drop0) : s.moveTo(x, y - drop0)));
        if (drop1 === null) { s.lineTo(HW, y0 - 0.26); s.lineTo(-HW, y0 - 0.26); } else for (let i = n; i >= 0; i--) s.lineTo(pts[i][0], pts[i][1] - drop1);
        s.closePath();
        return s;
      };
      rc.add(wood(CEDAR_DARK, 0), new THREE.ExtrudeGeometry(band(0.03, 0.3), { depth: 0.07, bevelEnabled: false }), faceM('n', doorX, z0 - 0.02));
      rc.add(M.plaster, new THREE.ShapeGeometry(band(0.1, null)), faceM('n', doorX, z0 + 0.07)); // 弧下是白壁，襯出深色的木雕
      rc.add(M.dark, new THREE.ShapeGeometry(band(0.02, null)), new THREE.Matrix4().makeTranslation(doorX, 0, z1));
      rc.add(wood(CEDAR_DARK, 0), boxGeo(HW * 2 - 0.3, 0.22, 0.17, doorX, y0 - 0.16, z0 + 0.0)); // 虹樑
      rc.add(DARK1, gegyoGeo(0.82, true), faceM('n', doorX, 0).setPosition(doorX, y0 + KH - 0.06, z0 - 0.09)); // 兎毛通（從破風板的頂點垂下，兩旁有鰭）
      // 蟇股：坐在虹樑正中央，兩腳往外張開，中間挖空處有一朵雕花
      rc.add(wood(CEDAR_DARK, 0), kaerumataGeo(1.5, 0.4), new THREE.Matrix4().makeTranslation(doorX, y0 - 0.05, z0 + 0.03));
      // 入口兩側的提燈
      for (const sd of [-1, 1]) {
        const x = doorX + sd * 0.98, y = 2.28, z = 8.75;
        const pm = M.paper.clone();
        const body = mesh(world, new THREE.SphereGeometry(0.15, 20, 14), pm, x, y, z, false);
        body.scale.y = 1.3;
        cyl(yg, 0.075, 0.085, 0.035, x, y + 0.2, z, M.dark, 14);
        cyl(yg, 0.085, 0.075, 0.035, x, y - 0.2, z, M.dark, 14);
        cyl(yg, 0.005, 0.005, 0.36, x, y + 0.4, z, M.dark, 4);
        lamps.push({ x, y, z, kind: 'chochin', mat: pm, paper: body });
      }
      // 簷口的銅雨樋（唐破風的兩旁各一段）
      for (const [a, b] of [[E.x0 - 0.55, doorX - HW - 0.04], [doorX + HW + 0.04, E.x1 + 0.55]]) rc.add(M.copper, rodGeo(P3(a, pentEaveY - 0.1, pentEaveZ - 0.1), P3(b, pentEaveY - 0.1, pentEaveZ - 0.1), 0.05, 10));
    }

    // --- 大屋頂：本瓦葺的入母屋（四周一圈斜簷，上半是山形，兩端的妻面有木連格子與懸魚） ---
    const A0 = Y.x0 - 0.9, A1 = Y.x1 + 0.9, zF = zc - half, zB = zc + half, HIP = 1.7, yH = eaveY + HIP * PITCH;
    const G0 = A0 + HIP - 0.35, G1 = A1 - HIP + 0.35;
    for (const [ze, zh] of [[zF, zF + HIP], [zB, zB - HIP]]) {
      tilePlane(rc, [P3(A0, eaveY, ze), P3(A1, eaveY, ze), P3(A1 - HIP, yH, zh), P3(G1, yH, zh), P3(G1, ridgeY, zc), P3(G0, ridgeY, zc), P3(G0, yH, zh), P3(A0 + HIP, yH, zh)],
        [[P3(A0, eaveY, ze), P3(A1, eaveY, ze)]]);
    }
    for (const [xe, xh, dir] of [[A0, A0 + HIP, 'w'], [A1, A1 - HIP, 'e']]) {
      tilePlane(rc, [P3(xe, eaveY, zF), P3(xe, eaveY, zB), P3(xh, yH, zB - HIP), P3(xh, yH, zF + HIP)], [[P3(xe, eaveY, zF), P3(xe, eaveY, zB)]]);
      gableFace(rc, faceM(dir, xh, zc), { yb: yH, ya: ridgeY, q: PITCH, over: 0.27, grain: 2 });
      // 隅棟（四個角往下的棟）與妻面底下的一道棟
      for (const [ze, zh] of [[zF, zF + HIP], [zB, zB - HIP]]) {
        const sx = Math.sign(xe - xh), sz = Math.sign(ze - zh); // 上端收在上半屋面的簷邊外，不要戳進屋面
        const a = P3(xh + sx * 0.42, yH - 0.12, zh + sz * 0.42), b = P3(xe - sx * 0.12, eaveY + 0.1, ze - sz * 0.12);
        rc.add(M.tile, barGeo(a, b, 0.2, 0.17));
        rc.add(M.tile, rodGeo(a.clone().setY(a.y + 0.1), b.clone().setY(b.y + 0.1), 0.07));
      }
      rc.add(M.tile, barGeo(P3(xh, yH + 0.06, zF + HIP), P3(xh, yH + 0.06, zB - HIP), 0.2, 0.16));
      // 大棟兩端的鬼瓦
      const xo = dir === 'w' ? G0 : G1;
      rc.add(M.tile, oniGeo(1.25), faceM(dir, xo, zc).setPosition(xo, ridgeY - 0.08, zc));
    }
    rc.add(M.tile, barGeo(P3(G0, ridgeY + 0.13, zc), P3(G1, ridgeY + 0.13, zc), 0.3, 0.34)); // 大棟
    rc.add(M.tile, rodGeo(P3(G0 - 0.04, ridgeY + 0.31, zc), P3(G1 + 0.04, ridgeY + 0.31, zc), 0.1, 10));
    // 屋簷底下（正面與兩側看得到）
    const UE = 1.5;
    underside(roofG, [P3(A0, eaveY, zF), P3(A1, eaveY, zF), P3(A1 - UE, eaveY + UE * PITCH, zF + UE), P3(A0 + UE, eaveY + UE * PITCH, zF + UE)], CEDAR_DARK);
    for (const [xe, sx] of [[A0, 1], [A1, -1]]) underside(roofG, [P3(xe, eaveY, zF), P3(xe, eaveY, zB), P3(xe + sx * UE, eaveY + UE * PITCH, zB - UE), P3(xe + sx * UE, eaveY + UE * PITCH, zF + UE)], CEDAR_DARK);

    // --- 千鳥破風：入口正上方前後兩層（前面小的貼著簷口，後面大的退在屋面上） ---
    const chidori = (hw, zf, q, oni) => {
      const yb = eaveY + (zf - zF) * PITCH, ya = yb + hw * q, zEnd = zF + (ya - eaveY) / PITCH + 0.05, ov = 0.34, ex = 0.3;
      for (const sd of [-1, 1]) {
        const xe = doorX + sd * (hw + ex), ye = yb - ex * q;
        tilePlane(rc, [P3(xe, ye, zf - ov), P3(doorX, ya, zf - ov), P3(doorX, ya, zEnd), P3(xe, ye, zf + 0.7)]);
        rc.add(M.tile, rodGeo(P3(xe, ye + 0.03, zf - ov + 0.07), P3(doorX, ya + 0.03, zf - ov + 0.07), 0.062)); // 螻羽的丸瓦
      }
      rc.add(M.tile, barGeo(P3(doorX, ya + 0.08, zf - ov - 0.02), P3(doorX, ya + 0.08, zEnd), 0.22, 0.2));
      rc.add(M.tile, rodGeo(P3(doorX, ya + 0.2, zf - ov - 0.04), P3(doorX, ya + 0.2, zEnd), 0.08));
      rc.add(M.tile, oniGeo(oni), faceM('n', doorX, 0).setPosition(doorX, ya - 0.04, zf - ov - 0.02));
      gableFace(rc, faceM('n', doorX, zf), { yb, ya, q, over: ov - 0.08, grain: 0 });
    };
    chidori(1.3, zF + 0.15, 0.55, 0.8);
    chidori(2.3, zF + 1.1, 0.55, 0.9);

    // --- 望樓：坐在屋脊中央的小樓。下半是下見板，上半白壁、四面格子窗（夜裡透暖黃的光），緑青銅板的寄棟屋頂，頂上一顆寶珠 ---
    {
      const tx = doorX, tz = zc, hx = 1.2, hz = 0.82, y0 = 6.3, yb = 7.42, wy0 = 7.72, wy1 = 8.4, yt = 8.62;
      const ry = yt + 0.08, ex = hx + 0.62, ez = hz + 0.62, rl = ex - ez, apex = ry + ez * 0.56;
      const dw = wood(CEDAR_DARK, 0);
      rc.add(wood(CEDAR, 0, 0.15, 0.6, true), boxGeo(hx * 2, yb - y0, hz * 2, tx, (y0 + yb) / 2, tz));    // 腰：下見板
      rc.add(dw, boxGeo(hx * 2 + 0.14, 0.09, hz * 2 + 0.14, tx, yb, tz));                                  // 見切
      rc.add(M.plaster, boxGeo(hx * 2 - 0.04, yt - yb, hz * 2 - 0.04, tx, (yt + yb) / 2, tz));             // 白壁
      rc.add(dw, boxGeo(hx * 2 + 0.16, 0.12, hz * 2 + 0.16, tx, yt, tz));                                  // 桁
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) rc.add(DARK1, boxGeo(0.12, yt - yb, 0.12, tx + sx * (hx - 0.03), (yt + yb) / 2, tz + sz * (hz - 0.03)));
      // 四面的格子窗：和紙在裡、直格在外（約 22 公分一格，2026-11-18 使用者覺得 10 公分太密）
      for (const [ax, az, hw, off] of [[1, 0, hx - 0.3, hz], [0, 1, hz - 0.26, hx]]) for (const sd of [-1, 1]) {
        const ox = tx + az * sd * off, oz = tz + ax * sd * off, ym = (wy0 + wy1) / 2, wh = wy1 - wy0;
        const bx = (len, h, t, u, y, out) => boxGeo(ax ? len : t, h, az ? len : t, ox + ax * u + az * sd * out, y, oz + az * u + ax * sd * out);
        rc.add(SHOJI_UP, bx(hw * 2, wh, 0.02, 0, ym, 0));
        const nb = Math.round((hw * 2) / 0.22);
        for (let k = 1; k < nb; k++) rc.add(dw, bx(0.022, wh, 0.03, -hw + (k / nb) * hw * 2, ym, 0.02));
        for (const y of [wy0 + wh / 3, wy0 + (wh * 2) / 3]) rc.add(dw, bx(hw * 2, 0.018, 0.024, 0, y, 0.02));
        for (const y of [wy0 - 0.03, wy1 + 0.03]) rc.add(dw, bx(hw * 2 + 0.16, 0.06, 0.08, 0, y, 0.03)); // 窗台與楣
        for (const u of [-hw - 0.03, hw + 0.03]) rc.add(DARK1, bx(0.06, wh, 0.06, u, ym, 0.02));
      }
      // 寄棟屋頂（四面同一個斜率，銅板的排才會在隅棟對齊）
      const c00 = P3(tx - ex, ry, tz - ez), c10 = P3(tx + ex, ry, tz - ez), c01 = P3(tx - ex, ry, tz + ez), c11 = P3(tx + ex, ry, tz + ez);
      const r0 = P3(tx - rl, apex, tz), r1 = P3(tx + rl, apex, tz);
      sheetPlane(rc, [c00, c10, r1, r0]);
      sheetPlane(rc, [c01, c11, r1, r0]);
      sheetPlane(rc, [c00, c01, r0]);
      sheetPlane(rc, [c10, c11, r1]);
      rc.add(M.patina, boxGeo(ex * 2 + 0.04, 0.05, ez * 2 + 0.04, tx, ry - 0.03, tz));   // 簷口的唐草（銅板收邊）
      rc.add(dw, boxGeo(ex * 2 - 0.12, 0.06, ez * 2 - 0.12, tx, ry - 0.08, tz));         // 軒裏
      for (let x = -ex + 0.22; x < ex - 0.1; x += 0.3) rc.add(dw, boxGeo(0.05, 0.06, ez * 2 - 0.2, tx + x, ry - 0.13, tz)); // 垂木
      for (const [r, cs] of [[r0, [c00, c01]], [r1, [c10, c11]]]) for (const cn of cs) rc.add(M.patina, rodGeo(r.clone().setY(apex + 0.02), cn.clone().setY(ry + 0.03), 0.04, 6));
      rc.add(M.patina, boxGeo(rl * 2 + 0.36, 0.13, 0.17, tx, apex + 0.03, tz));           // 棟
      rc.add(M.patina, boxGeo(0.3, 0.1, 0.3, tx, apex + 0.13, tz));                       // 露盤
      rc.add(M.patina, new THREE.SphereGeometry(0.105, 14, 10).translate(tx, apex + 0.27, tz));
      rc.add(M.patina, new THREE.ConeGeometry(0.06, 0.16, 12).translate(tx, apex + 0.4, tz)); // 寶珠的尖
    }

    // --- 銅色的雨樋：大屋簷正面的橫樋，兩端的集水斗與豎樋 ---
    rc.add(M.copper, rodGeo(P3(A0 + 0.25, eaveY - 0.11, zF - 0.08), P3(A1 - 0.25, eaveY - 0.11, zF - 0.08), 0.055, 10));
    for (const x of [Y.x0 - 0.42, Y.x1 + 0.42]) {
      const zw = front - 0.1;
      rc.add(M.copper, boxGeo(0.15, 0.18, 0.15, x, eaveY - 0.24, zF - 0.08));
      rc.add(M.copper, rodGeo(P3(x, eaveY - 0.3, zF - 0.08), P3(x, eaveY - 0.95, zw), 0.04));
      rc.add(M.copper, rodGeo(P3(x, eaveY - 0.93, zw), P3(x, 0.12, zw), 0.04));
      for (const y of [4.2, 3.0, 1.8, 0.6]) rc.add(M.copper, new THREE.CylinderGeometry(0.052, 0.052, 0.04, 8).translate(x, y, zw));
    }

    // --- 鎖樋：下屋簷兩端垂下的雨鏈，落進石水缽 ---
    for (const x of [E.x0 - 0.45, E.x1 + 0.45]) {
      const top = pentEaveY - 0.12, z = pentEaveZ + 0.1;
      for (let y = top; y > 0.5; y -= 0.11) rc.add(M.chain, new THREE.CylinderGeometry(0.035, 0.018, 0.07, 8, 1, true).translate(x, y, z));
      const bowl = mesh(world, rockGeometry(rand, 20), M.stone, x, 0.2, z);
      bowl.scale.set(0.4, 0.26, 0.4);
      const wtr = mesh(world, new THREE.CircleGeometry(0.22, 20), std({ color: 0x24403f, roughness: 0.08 }), x, 0.385, z, false);
      wtr.rotation.x = -Math.PI / 2;
      L.circles.push({ x, z, r: 0.42 });
    }
    rc.flush(roofG);
    bake(world, yg);
  }

  // ---------- 東屋（半露天） ----------
  {
    const A = L.AZUMAYA, cx = (A.x0 + A.x1) / 2, zc = (A.z0 + A.z1) / 2, half = (A.z1 - A.z0) / 2;
    L.AZUMAYA_POSTS.forEach(([x, z]) => {
      const base = L.groundY(x, z);
      wbox(world, 0.2, A.eave - base, 0.2, x, (A.eave + base) / 2, z, CEDAR_DARK);
      const st = mesh(world, rockGeometry(rand, 16), M.stone, x, base + 0.03, z);
      st.scale.set(0.3, 0.14, 0.3);
      // 方杖：柱頭往桁斜撐
      for (const sx of [-1, 1]) {
        if ((sx < 0 && x < cx) || (sx > 0 && x > cx)) continue;
        const b = wbox(world, 0.09, 0.9, 0.09, x + sx * 0.3, A.eave - 0.36, z, CEDAR_DARK);
        b.rotation.z = -sx * 0.78;
      }
    });
    for (const z of [A.z0 + 0.4, A.z1 - 0.4]) wbox(world, A.x1 - A.x0 + 0.5, 0.2, 0.16, cx, A.eave + 0.02, z, CEDAR_DARK);
    for (const x of [A.x0 + 0.4, cx, A.x1 - 0.4]) {
      wbox(world, 0.16, 0.18, A.z1 - A.z0 - 0.4, x, A.eave + 0.2, zc, CEDAR_DARK);
      wbox(world, 0.12, A.ridge - A.eave - 0.25, 0.12, x, (A.ridge + A.eave) / 2 + 0.12, zc, CEDAR_DARK);
    }
    gable(world, { x0: A.x0, x1: A.x1, zc, half: half + 0.5, eaveY: A.eave - 0.02, ridgeY: A.ridge + 0.22, over: 0.45 });
  }

  // ---------- 望景木台 ----------
  const dk = new THREE.Group(); // 欄杆、足湯、躺椅木台的零件先收在這裡，最後合併
  {
    const D = L.DECK, w = D.x1 - D.x0, cx = (D.x0 + D.x1) / 2, d = D.z1 - D.z0 + 0.6, cz = (D.z0 + D.z1) / 2 - 0.3;
    wbox(world, w, 0.05, d, cx, D.y - 0.025, cz, DECK_WOOD, { grain: 0, plank: 0.13, weather: 0.7 });
    wbox(world, w, D.y - 0.05, 0.06, cx, (D.y - 0.05) / 2, D.z1 - 0.03, CEDAR);
    for (const x of [D.x0 + 0.03, D.x1 - 0.03]) wbox(world, 0.06, D.y - 0.05, d, x, (D.y - 0.05) / 2, cz, CEDAR);
    for (let x = D.x0 + 0.2; x <= D.x1; x += 1.4) for (const z of [D.z0 - 0.4, D.z0 + 1.6]) wbox(world, 0.14, 4, 0.14, x, D.y - 2.05, z, CEDAR_DARK);
    // 欄杆：正面中段（足湯前）是矮欄，兩旁與側面是高欄
    const top = D.y + 0.86, A = L.ASHIYU, lowX = 2.7;
    for (const sd of [-1, 1]) {
      const xm = sd * (lowX + D.x1) / 2, len = D.x1 - lowX;
      wbox(dk, len + 0.1, 0.07, 0.1, xm, top, D.z0, CEDAR_DARK);
      wbox(dk, len, 0.045, 0.05, xm, D.y + 0.45, D.z0, CEDAR_DARK);
      for (const x of [lowX, (lowX + D.x1) / 2, D.x1]) wbox(dk, 0.09, 0.86, 0.09, sd * x, D.y + 0.43, D.z0, CEDAR_DARK);
    }
    wbox(dk, lowX * 2, 0.06, 0.09, cx, D.y + A.railH, A.railZ, CEDAR_DARK);
    for (const x of [-1.35, 0, 1.35]) wbox(dk, 0.075, A.railH, 0.075, x, D.y + A.railH / 2, A.railZ, CEDAR_DARK);
    for (const x of [D.x0, D.x1]) {
      const len = D.z1 - D.z0 - 1.2, zz = D.z0 + len / 2;
      wbox(dk, 0.1, 0.07, len, x, top, zz, CEDAR_DARK);
      wbox(dk, 0.05, 0.045, len, x, D.y + 0.45, zz, CEDAR_DARK);
      wbox(dk, 0.09, 0.86, 0.09, x, D.y + 0.43, D.z0 + len, CEDAR_DARK);
    }
    // 崖邊欄杆：立在地面上，頂端與木台的欄杆同高，一路接到東西竹垣
    L.CLIFF_RAILS.forEach((r) => {
      const len = r.x1 - r.x0, xm = (r.x0 + r.x1) / 2;
      wbox(dk, len, 0.07, 0.1, xm, top, D.z0, CEDAR_DARK);
      for (const y of [D.y + 0.45, 0.32]) wbox(dk, len, 0.045, 0.05, xm, y, D.z0, CEDAR_DARK);
      const n = Math.round(len / 1.6);
      for (let i = 0; i <= n; i++) {
        const x = r.x0 + (len * i) / n;
        if (Math.abs(Math.abs(x) - D.x1) < 0.01) continue; // 木台轉角已經有柱
        wbox(dk, 0.09, top + 0.2, 0.09, x, (top - 0.2) / 2, D.z0, CEDAR_DARK);
      }
    });

    // 足湯：檜木槽，南側是坐板。水面、注水的水柱在 water.js
    {
      const y0 = D.y, w = A.x1 - A.x0, t = A.wall, tubD = A.seatZ0 - A.tubZ0, tubZ = (A.seatZ0 + A.tubZ0) / 2;
      const ASHI = 0xc79a62; // 新一點、偏暖的檜木色
      const H = { weather: 0.04 }, HP = { grain: 0, plank: 0.167, weather: 0.05 };
      wbox(dk, w, 0.04, tubD, cx, y0 + A.floorY - 0.02, tubZ, ASHI, { grain: 0, plank: 0.14, weather: 0.04 });       // 槽底
      wbox(dk, w + t * 2, A.h, t, cx, y0 + A.h / 2, A.tubZ0 - t / 2, ASHI, { grain: 0, plank: 0.2, plankY: true, weather: 0.04 }); // 外側板
      wbox(dk, w, A.h, t, cx, y0 + A.h / 2, A.seatZ0 + t / 2, ASHI, { grain: 0, plank: 0.2, plankY: true, weather: 0.04 });      // 內側板（坐板下）
      for (const sd of [-1, 1]) {
        const x = sd * (w / 2 + t / 2);
        wbox(dk, t, A.h, A.seatZ1 - A.tubZ0, x, y0 + A.h / 2, (A.seatZ1 + A.tubZ0) / 2, ASHI, { grain: 2, plank: 0.2, plankY: true, weather: 0.04 }); // 端板
        wbox(dk, 0.12, 0.03, tubD + t, sd * (w / 2 + t / 2), y0 + A.h + 0.015, tubZ - t / 2, ASHI, H); // 端板上的笠木
      }
      wbox(dk, w + t * 2 + 0.06, 0.03, 0.12, cx, y0 + A.h + 0.015, A.tubZ0 - t / 2, ASHI, H);           // 外側的笠木
      wbox(dk, w + t * 2 + 0.04, 0.045, A.seatZ1 - A.seatZ0 + 0.07, cx, y0 + A.h + 0.0225, (A.seatZ0 + A.seatZ1) / 2 - 0.035, ASHI, HP); // 坐板
      wbox(dk, w + t * 2, A.h, 0.03, cx, y0 + A.h / 2, A.seatZ1 - 0.045, ASHI, { grain: 0, plank: 0.2, plankY: true, weather: 0.04 }); // 坐板下的前板
      for (let x = A.x0; x <= A.x1 + 0.01; x += 1.25) wbox(dk, 0.05, A.h, 0.025, x, y0 + A.h / 2, A.seatZ1 - 0.02, CEDAR_DARK);
      // 注水的竹筒：東端一支竹柱，橫出一節細竹
      const S = A.spout, bam = wood(0x9a8a4e, 1, 0, 0.2);
      const px = A.x1 + t + 0.14;
      cyl(world, 0.045, 0.048, S.y - y0 + 0.2, px, y0 + (S.y - y0 + 0.2) / 2, S.z, bam, 14);
      const pipe = cyl(world, 0.024, 0.026, px - S.x + 0.12, (px + S.x) / 2 + 0.04, S.y + 0.035, S.z, bam, 12);
      pipe.rotation.z = Math.PI / 2 - 0.1;
    }
  }

  // ---------- 西翼：躺椅的低木台（躺椅與小几在 props.js） ----------
  {
    const P = L.LOUNGE, w = P.x1 - P.x0, d = P.z1 - P.z0, cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
    wbox(dk, w, 0.04, d, cx, P.y - 0.02, cz, DECK_WOOD, { grain: 2, plank: 0.13, weather: 0.55 });
    for (const z of [P.z0 + 0.025, P.z1 - 0.025]) wbox(dk, w, P.y - 0.04, 0.05, cx, (P.y - 0.04) / 2, z, CEDAR);
    for (const x of [P.x0 + 0.025, P.x1 - 0.025]) wbox(dk, 0.05, P.y - 0.04, d - 0.1, x, (P.y - 0.04) / 2, cz, CEDAR);
  }
  bake(world, dk);

  // ---------- 東翼：壺湯 ----------
  // 圓形淺池（深色石板底、低矮的花崗石緣）中央一顆飴釉陶壺，壺後立竹筒湯口；水面、溢流、水柱在 water.js
  {
    const T = L.TSUBO, P = T.pot, g = new THREE.Group();
    // 旋轉體的輪廓要「外側由下往上、頂面由外往內、內側由上往下」，法線才會朝外
    const lat = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    const SLATE = patch(std({ color: 0x505855 }), 'STONE');
    mesh(g, new THREE.CylinderGeometry(T.r + 0.02, T.r + 0.02, T.floorY, 72), SLATE, T.x, T.floorY / 2, T.z);
    const R0 = T.r, R1 = T.r + T.rimW, H = T.rimH, c = 0.02;
    mesh(g, lat([[R1, -0.03], [R1, H - c], [R1 - c, H], [R0 + c, H], [R0, H - c], [R0, 0]], 96), M.stone, T.x, 0, T.z);
    // 六角踏石：進出壺時踩的台階
    T.steps.forEach(([x, z, r, h], i) => {
      const hg = new THREE.CylinderGeometry(r, r * 1.03, h, 6).toNonIndexed();
      hg.computeVertexNormals();
      mesh(g, hg, M.stone, x, T.floorY + h / 2, z).rotation.y = 0.35 + i * 0.5;
    });
    bake(world, g);

    // 陶壺：外側貼飴釉的貼圖（v 照高度重算），內側是素面的深褐釉
    const og = lat(L.potProfile(), 80), uv = og.attributes.uv, op = og.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setY(i, Math.min(1, op.getY(i) / P.h));
    const glaze = std({ map: glazeTexture(rng(20261117)), color: 0xbcaea4, roughness: 0.2 });
    const pot = mesh(world, og, glaze, T.x, T.floorY, T.z);
    pot.name = 'tsubo-pot';
    const sy = P.seatY - T.floorY;
    const ig = lat([[P.inner + 0.03, P.h + 0.004], [P.inner, P.h - 0.03], [P.inner - 0.01, 0.5], [P.inner - 0.07, 0.3], [P.inner - 0.2, sy], [0, sy]], 64);
    mesh(world, ig, std({ color: 0x55290f, roughness: 0.3, side: THREE.DoubleSide }), T.x, T.floorY, T.z, false);

    // 竹筒湯口：立在淺池裡的竹柱，橫出一節竹管伸到壺口上方
    const S = T.spout, bam = wood(0x9a8a4e, 1, 0, 0.2);
    cyl(world, 0.05, 0.054, S.postH, S.postX, T.floorY + S.postH / 2, T.z, bam, 16);
    const len = S.postX - S.tip.x + 0.14, rise = 0.09;
    const pipe = cyl(world, 0.03, 0.033, len, (S.postX + S.tip.x) / 2 + 0.05, S.tip.y + 0.03 + rise / 2, T.z, bam, 14);
    pipe.rotation.z = Math.PI / 2 + Math.atan2(rise, len);
  }

  // ---------- 竹垣 ----------
  L.FENCES.forEach((f) => {
    const w = f.x1 - f.x0, d = f.z1 - f.z0, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
    box(world, Math.max(w, 0.07), 1.85, Math.max(d, 0.07), cx, 0.925, cz, M.bamboo);
    const alongX = w > d, len = alongX ? w : d;
    const cap = cyl(world, 0.05, 0.05, len, cx, 1.9, cz, wood(0x8a7a48, 1, 0, 0.2), 8);
    if (alongX) cap.rotation.z = Math.PI / 2; else cap.rotation.x = Math.PI / 2;
    for (let s = 0; s <= len + 0.01; s += 1.9) {
      const px = alongX ? f.x0 + s : cx, pz = alongX ? cz : f.z0 + s;
      cyl(world, 0.065, 0.07, 2.0, px, 1.0, pz, wood(CEDAR_DARK, 1), 8);
    }
  });

  // ---------- 飛石 ----------
  L.PATH_STONES.forEach(([x, z, r]) => {
    const s = mesh(world, rockGeometry(rand, 16), M.stone, x, 0.0, z);
    s.scale.set(r * 1.05, 0.07, r * (0.85 + rand() * 0.25));
    s.rotation.y = rand() * 3;
    s.castShadow = false;
  });

  // 北側山坡、海灣與四周的山在 vista.js

  return { world, lamps };
}
