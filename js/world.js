// 把 layout.js 的平面圖蓋成實際的場景：地形、岩石、湯屋、東屋、望景台、竹垣。
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
  plaster: patch(std({ color: 0xd9c8a8 }), 'PLASTER'),
  bamboo: patch(std(), 'BAMBOO'),
  paper: std({ color: 0xf3e3c2, emissive: 0xffc27a, emissiveIntensity: 0.12, roughness: 1 }),
  dark: std({ color: 0x0c0a09, roughness: 1 }),
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
const SHOJI_NIGHT = 0.95;    // 夜晚窗紙透光的亮度（相對於燈籠的和紙）
const SHOJI_ALBEDO = 0.2;    // 夜晚窗紙反光的比例（1 = 和白天一樣白）

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

// 鳥瞰時要隱藏的東西（屋頂、樹冠）
export const OVERHEAD = [];

// 一片屋面：杮葺、底下的野地板與一根根垂木。side 表示簷口在本地座標的哪一端
function roofSlope(g, cx, y, z, len, sl, side, ang, color) {
  const s = new THREE.Group();
  s.position.set(cx, y, z);
  s.rotation.x = side * ang;
  g.add(s);
  OVERHEAD.push(s);
  box(s, len, 0.09, sl + 0.12, 0, 0.02, 0, M.roof);
  wbox(s, len - 0.04, 0.025, sl, 0, -0.04, 0, BOARD, { grain: 0, plank: 0.16, weather: 0.25 });
  for (let x = -len / 2 + 0.2; x <= len / 2 - 0.15; x += 0.46) wbox(s, 0.055, 0.085, sl + 0.06, x, -0.095, 0, color, { grain: 2 });
  wbox(s, len, 0.12, 0.045, 0, -0.03, side * (sl / 2 + 0.05), color); // 鼻隱板
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

export function buildWorld(scene) {
  // 窗紙：與燈籠共用的 M.paper 分開。日間 map 是單純的和紙；夜裡的影絵畫在各窗自己的 emissiveMap（見 shoji.js）。
  const ST = shojiTextures(fbm, rng);
  // 夜間發光強度由 daynight.js 驅動 M.paper；窗紙用 getter 直接跟著它（不必改 daynight.js）
  // G.house 降到 0（場內的燈全熄）時，窗內也只剩一點餘光
  const shojiMat = (emap) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xf3e3c2, map: ST.plain, emissive: 0xffc27a, emissiveMap: emap, emissiveIntensity: M.paper.emissiveIntensity, roughness: 1 });
    const col = m.color.clone();
    Object.defineProperty(m, 'emissiveIntensity', {
      // 夜裡窗紙略暗於燈籠（SHOJI_NIGHT）；窗前那兩盞「窗內透出的光」點光源會把白紙照到過曝，
      // 所以夜裡把紙的反光壓低（SHOJI_ALBEDO），亮度主要來自自己的透光與影絵的對比。
      // three 每畫一次都會讀這個值，順便在這裡更新顏色。
      get: () => {
        const p = M.paper.emissiveIntensity, n = G.night.value, h = G.house.value;
        m.color.copy(col).multiplyScalar(1 - (1 - SHOJI_ALBEDO) * n);
        return p * (1 - (1 - SHOJI_NIGHT) * n) * h + Math.min(p, 0.12) * (1 - 0.75 * n) * (1 - h);
      },
      set() {}, configurable: true,
    });
    return m;
  };
  const SHOJI = shojiMat(ST.plain);
  const SHOJI_LOWER = { 1: shojiMat(ST.panels[0]), 2: shojiMat(ST.panels[1]), 5: shojiMat(ST.panels[2]), 6: shojiMat(ST.panels[3]) };
  const SHOJI_ROUND = shojiMat(ST.round);
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
  // 把池岸連成一圈的中小型石塊；三個入口處只放低矮的踏石
  const gaps = [[2.14, 0.3], [Math.PI, 0.42], [-Math.PI, 0.42], [-1.57, 0.34]];
  const inGap = (th) => gaps.some(([c, w]) => Math.abs(th - c) < w);
  for (let i = 0; i < 84; i++) {
    const th = -Math.PI + (i / 84) * Math.PI * 2 + (rand() - 0.5) * 0.04;
    const [x, z] = L.poolPoint(th, 1.015 + rand() * 0.045);
    if (L.RIM_ROCKS.some((k) => Math.hypot(k.x - x, k.z - z) < k.r * 0.85)) { rand(); rand(); continue; }
    if (inGap(th)) rock(world, rand, x, z, 0.3 + rand() * 0.14, 0.12, -0.04, 14);
    else rock(world, rand, x, z, 0.26 + rand() * 0.26, 0.2 + rand() * 0.26, -0.1, 18);
  }
  // 池畔散置的景石
  for (const [x, z, r, h] of [[-10.2, 1.4, 0.55, 0.5], [7.4, 6.6, 0.7, 0.6], [11.6, 1.2, 0.8, 0.75], [-6.6, -7.4, 0.6, 0.45], [4.6, -7.0, 0.5, 0.4], [-11.8, 8.6, 0.65, 0.5], [12.4, -9.4, 0.9, 0.8]]) {
    rock(world, rand, x, z, r, h, -0.12, 22);
  }

  // 湯口：岩堆中伸出的竹筒
  {
    const spout = cyl(world, 0.055, 0.06, 1.5, L.YUGUCHI.x + 0.74, L.YUGUCHI.y + 0.06, L.YUGUCHI.z, wood(0x9a8a4e, 1, 0, 0.2), 12);
    spout.rotation.z = Math.PI / 2 - 0.09;
  }

  // ---------- 湯屋與簷廊 ----------
  // 兩層構成：下層是深簷的下屋與簷廊，上層退在後面開一整排連子窗，屋脊上有排出蒸氣的「湯氣拔き」，
  // 入口上方是一座千鳥破風。
  const lamps = []; // 之後要發光的燈具位置（第四階段接上光源）
  {
    const Y = L.YUYA, E = L.ENGAWA;
    const zc = 13.5, half = 3.7, eaveY = 5.3, ridgeY = 7.0, wallTop = 5.8;
    const pentTop = 3.5, pentEaveY = 2.85, pentEaveZ = 8.2;
    const w = Y.x1 - Y.x0, cx = (Y.x0 + Y.x1) / 2, fz = Y.z0;
    const DOOR = 3, ROUND = 4;
    // 牆身與石砌基座
    box(world, w, wallTop - E.y, Y.z1 - Y.z0, cx, (wallTop + E.y) / 2, (Y.z0 + Y.z1) / 2, M.plaster);
    box(world, w + 0.2, E.y, Y.z1 - Y.z0 + 0.1, cx, E.y / 2, (Y.z0 + Y.z1) / 2, M.stone);
    M.plaster.side = THREE.DoubleSide;
    for (const x of [Y.x0 - 0.01, Y.x1 + 0.01]) {
      const tri = new THREE.Shape();
      const zAt = (y) => ((ridgeY - y) / (ridgeY - eaveY)) * half;
      tri.moveTo(-zAt(wallTop), wallTop); tri.lineTo(zAt(wallTop), wallTop); tri.lineTo(0, ridgeY - 0.08); tri.closePath();
      mesh(world, new THREE.ShapeGeometry(tri), M.plaster, x, 0, zc).rotation.y = Math.PI / 2;
      // 破風板
      for (const sd of [-1, 1]) {
        const bl = Math.hypot(half + 0.8, ridgeY - eaveY + 0.35);
        const bb = wbox(world, 0.06, 0.2, bl, x + Math.sign(x - cx) * 0.75, (eaveY + ridgeY) / 2 - 0.12, zc + sd * (half + 0.8) / 2, CEDAR_DARK, { grain: 2 });
        bb.rotation.x = sd * Math.atan2(ridgeY - eaveY, half);
        OVERHEAD.push(bb);
      }
    }
    const bays = 8, bw = w / bays, front = fz - 0.05;
    // 通柱（從基座一路到上層桁）
    for (let i = 0; i <= bays; i++) wbox(world, 0.18, wallTop - E.y, 0.18, Y.x0 + i * bw, (wallTop + E.y) / 2, front, CEDAR_DARK);
    wbox(world, w, 0.14, 0.1, cx, E.y + 2.18, front - 0.04, CEDAR_DARK);   // 長押
    wbox(world, w, 0.2, 0.14, cx, pentTop + 0.12, front - 0.04, CEDAR_DARK); // 胴差
    wbox(world, w, 0.18, 0.14, cx, wallTop - 0.1, front - 0.04, CEDAR_DARK); // 上層桁

    // --- 下層各開間 ---
    const shoji = (bx, inner, y0, y1, cols, rows, mat = SHOJI) => {
      const hh = y1 - y0;
      box(world, inner, hh, 0.02, bx, (y0 + y1) / 2, front + 0.03, mat).castShadow = false;
      for (let c = 1; c < cols; c++) wbox(world, 0.018, hh, 0.025, bx - inner / 2 + (inner * c) / cols, (y0 + y1) / 2, front, CEDAR_DARK).castShadow = false;
      for (let r = 1; r < rows; r++) wbox(world, inner, 0.018, 0.025, bx, y0 + (hh * r) / rows, front, CEDAR_DARK).castShadow = false;
      wbox(world, inner, 0.05, 0.06, bx, y0 - 0.02, front - 0.01, CEDAR_DARK);
      wbox(world, inner, 0.05, 0.06, bx, y1 + 0.02, front - 0.01, CEDAR_DARK);
    };
    const doorX = Y.x0 + (DOOR + 0.5) * bw;
    for (let i = 0; i < bays; i++) {
      const bx = Y.x0 + (i + 0.5) * bw, inner = bw - 0.18;
      if (i === DOOR) {
        // 入口：深色的室內、踏板與暖簾
        box(world, inner, 2.1, 0.05, bx, E.y + 1.06, front + 0.02, M.dark);
        wbox(world, inner, 0.05, 0.3, bx, E.y + 0.025, front - 0.12, HINOKI, { weather: 0.2 });
        const cloth = new THREE.MeshStandardMaterial({ map: textTexture('湯', { bg: '#22335a', fg: '#efe6d2', scale: 6 }), roughness: 1, side: THREE.DoubleSide });
        wbox(world, inner + 0.1, 0.035, 0.035, bx, E.y + 2.04, front - 0.1, HINOKI);
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
      wbox(world, inner, 0.88, 0.04, bx, E.y + 0.44, front + 0.02, CEDAR, { grain: 0, plank: 0.15, plankY: true, weather: 0.6 });
      for (const ox of [-inner / 4, inner / 4]) wbox(world, 0.035, 0.88, 0.03, bx + ox, E.y + 0.44, front - 0.01, CEDAR_DARK); // 押縁
      if (i === ROUND) {
        // 丸窗
        const cy = E.y + 1.52, R = 0.52;
        const disc = mesh(world, new THREE.CircleGeometry(R, 40), SHOJI_ROUND, bx, cy, front - 0.005, false);
        disc.rotation.y = Math.PI;
        const ring = mesh(world, new THREE.TorusGeometry(R, 0.045, 8, 48), wood(CEDAR_DARK, 0), bx, cy, front - 0.02, false);
        ring.rotation.y = Math.PI;
        for (const t of [-0.5, 0, 0.5]) {
          const hl = Math.sqrt(1 - t * t) * R * 2;
          wbox(world, 0.02, hl, 0.02, bx + t * R, cy, front - 0.02, CEDAR_DARK).castShadow = false;
          wbox(world, hl, 0.02, 0.02, bx, cy + t * R, front - 0.02, CEDAR_DARK).castShadow = false;
        }
      } else if (i !== 0 && i !== bays - 1) {
        shoji(bx, inner, E.y + 0.95, E.y + 2.08, 7, 4, SHOJI_LOWER[i]);
      }
    }

    // --- 上層：一整排連子窗（直向細格） ---
    for (let i = 1; i < bays - 1; i++) {
      const bx = Y.x0 + (i + 0.5) * bw, inner = bw - 0.18, y0 = pentTop + 0.75, y1 = wallTop - 0.4;
      box(world, inner, y1 - y0, 0.02, bx, (y0 + y1) / 2, front + 0.03, SHOJI).castShadow = false;
      for (let c = 1; c < 14; c++) wbox(world, 0.03, y1 - y0, 0.035, bx - inner / 2 + (inner * c) / 14, (y0 + y1) / 2, front, CEDAR_DARK).castShadow = false;
      wbox(world, inner, 0.07, 0.09, bx, y0 - 0.03, front - 0.02, CEDAR_DARK);
      wbox(world, inner, 0.06, 0.07, bx, (y0 + y1) / 2, front - 0.005, CEDAR_DARK);
    }

    // --- 簷廊 ---
    wbox(world, E.x1 - E.x0, 0.06, E.z1 - E.z0, (E.x0 + E.x1) / 2, E.y - 0.03, (E.z0 + E.z1) / 2, HINOKI, { grain: 0, plank: 0.14, weather: 0.3 });
    wbox(world, E.x1 - E.x0, 0.14, 0.08, (E.x0 + E.x1) / 2, E.y - 0.12, E.z0 + 0.04, CEDAR);
    for (let x = E.x0 + 0.3; x < E.x1; x += 1.7) wbox(world, 0.1, E.y - 0.18, 0.1, x, (E.y - 0.18) / 2, E.z0 + 0.12, CEDAR_DARK);
    box(world, E.x1 - E.x0 - 0.2, E.y - 0.2, 0.05, (E.x0 + E.x1) / 2, (E.y - 0.2) / 2, E.z0 + 0.35, M.dark);
    const pz = E.z0 + 0.25;
    const beamY = pentEaveY + ((pz - pentEaveZ) / (fz - pentEaveZ)) * (pentTop - pentEaveY) - 0.2;
    L.ENGAWA_POSTS.forEach(([x, z]) => {
      wbox(world, 0.15, beamY - E.y, 0.15, x, (beamY + E.y) / 2, z, CEDAR_DARK);
      for (const sx of [-1, 1]) wbox(world, 0.07, 0.5, 0.07, x + sx * 0.17, beamY - 0.22, z, CEDAR_DARK).rotation.z = -sx * 0.75; // 肘木
    });
    wbox(world, E.x1 - E.x0 + 0.6, 0.18, 0.15, (E.x0 + E.x1) / 2, beamY, pz, CEDAR_DARK);
    // 連接柱與牆的繫樑
    L.ENGAWA_POSTS.forEach(([x]) => wbox(world, 0.1, 0.13, fz - pz, x, beamY + 0.12, (fz + pz) / 2, CEDAR_DARK));
    const ks = mesh(world, rockGeometry(rand, 26), M.stone, E.x0 + 5, 0.02, E.z0 - 0.38);
    ks.scale.set(2.0, 0.3, 0.5);
    pent(world, { x0: E.x0, x1: E.x1, zTop: fz, yTop: pentTop, zEave: pentEaveZ, yEave: pentEaveY, over: 0.6 });

    // 吊燈籠：掛在簷下
    const ps = L.ENGAWA_POSTS.map((q) => q[0]);
    for (let i = 0; i < ps.length - 1; i++) {
      const x = (ps[i] + ps[i + 1]) / 2;
      if (Math.abs(x - doorX) < 1.2) continue;
      const y = beamY - 0.42;
      cyl(world, 0.006, 0.006, 0.2, x, y + 0.26, pz, M.dark, 4);
      wbox(world, 0.2, 0.025, 0.2, x, y + 0.155, pz, CEDAR_DARK);
      const pm = M.paper.clone(); // 每盞各自一份，才能逐盞熄滅
      const body = box(world, 0.16, 0.28, 0.16, x, y, pz, pm);
      body.castShadow = false;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) wbox(world, 0.014, 0.28, 0.014, x + ox * 0.082, y, pz + oz * 0.082, CEDAR_DARK).castShadow = false;
      wbox(world, 0.19, 0.02, 0.19, x, y - 0.15, pz, CEDAR_DARK);
      lamps.push({ x, y, z: pz, kind: 'hanging', mat: pm, paper: body });
    }
    // 長椅與脫衣籠
    {
      const bx = 1.2, bz = E.z1 - 0.32;
      wbox(world, 1.5, 0.05, 0.42, bx, E.y + 0.4, bz, HINOKI, { grain: 0, plank: 0.14, weather: 0.25 });
      for (const sx of [-1, 1]) wbox(world, 0.06, 0.4, 0.36, bx + sx * 0.6, E.y + 0.2, bz, CEDAR_DARK, { grain: 1 });
      const kago = patch(std({ color: 0xb89a62 }), 'BAMBOO');
      for (const ox of [-0.35, 0.3]) {
        const k = cyl(world, 0.19, 0.15, 0.2, bx + ox, E.y + 0.53, bz, kago, 16);
        k.scale.z = 0.8;
      }
      L.boxes.push({ x0: bx - 0.75, x1: bx + 0.75, z0: bz - 0.21, z1: bz + 0.3 });
    }

    // --- 入口上方的千鳥破風 ---
    {
      const pg = new THREE.Group();
      const z0 = 7.85, z1 = 10.7, ph = 1.5, pe = 3.0, pr = 3.95;
      pg.position.set(doorX, 0, (z0 + z1) / 2);
      pg.rotation.y = Math.PI / 2;
      world.add(pg);
      gable(pg, { x0: -(z1 - z0) / 2, x1: (z1 - z0) / 2, zc: 0, half: ph, eaveY: pe, ridgeY: pr, over: 0.08, color: CEDAR_DARK });
      const tri = new THREE.Shape();
      tri.moveTo(-ph + 0.1, pe + 0.02); tri.lineTo(ph - 0.1, pe + 0.02); tri.lineTo(0, pr - 0.08); tri.closePath();
      const face = mesh(world, new THREE.ShapeGeometry(tri), M.plaster, doorX, 0, z0 + 0.12);
      OVERHEAD.push(face);
      const ang = Math.atan2(pr - pe, ph), bl = Math.hypot(ph, pr - pe) + 0.25;
      for (const sd of [-1, 1]) {
        const bb = wbox(world, bl, 0.17, 0.06, doorX + sd * (ph / 2 + 0.05), (pe + pr) / 2 - 0.05, z0 - 0.06, CEDAR_DARK, { grain: 0 });
        bb.rotation.z = -sd * ang;
        OVERHEAD.push(bb);
      }
      wbox(world, ph * 2 + 0.2, 0.13, 0.13, doorX, pe - 0.02, z0 + 0.05, CEDAR_DARK); // 虹樑
      // 懸魚：破風頂點垂下的木雕
      const g = new THREE.Shape();
      g.moveTo(0, 0.12); g.lineTo(0.13, 0.02); g.quadraticCurveTo(0.2, -0.16, 0, -0.34); g.quadraticCurveTo(-0.2, -0.16, -0.13, 0.02); g.closePath();
      const gy = mesh(world, new THREE.ExtrudeGeometry(g, { depth: 0.04, bevelEnabled: false }), wood(CEDAR_DARK, 1), doorX, pr - 0.3, z0 - 0.12);
      OVERHEAD.push(gy);
      // 看板
      const sign = new THREE.MeshStandardMaterial({ map: textTexture('湯', { bg: '#3a2a1e', fg: '#d8b46a', size: 170, w: 384, h: 256, scale: 4 }), roughness: 0.8 });
      const sb = mesh(world, new THREE.PlaneGeometry(0.72, 0.48), sign, doorX, pe + 0.33, z0 + 0.1);
      sb.rotation.y = Math.PI;
      wbox(world, 0.8, 0.56, 0.03, doorX, pe + 0.33, z0 + 0.12, CEDAR_DARK);
      // 入口兩側的提燈
      for (const sd of [-1, 1]) {
        const x = doorX + sd * 0.98, y = 2.28, z = 8.75;
        const pm = M.paper.clone();
        const body = mesh(world, new THREE.SphereGeometry(0.15, 20, 14), pm, x, y, z, false);
        body.scale.y = 1.3;
        cyl(world, 0.075, 0.085, 0.035, x, y + 0.2, z, M.dark, 14);
        cyl(world, 0.085, 0.075, 0.035, x, y - 0.2, z, M.dark, 14);
        cyl(world, 0.005, 0.005, 0.36, x, y + 0.4, z, M.dark, 4);
        lamps.push({ x, y, z, kind: 'chochin', mat: pm, paper: body });
      }
    }

    // --- 主屋頂與湯氣拔き ---
    gable(world, { x0: Y.x0, x1: Y.x1, zc, half, eaveY, ridgeY, over: 0.8 });
    {
      const vx0 = -8.2, vx1 = -1.2, vw = 0.72;
      const louver = wood(CEDAR_DARK, 0, 0.075, 0.5);
      const lv = patch(std({ color: 0x5c4433 }), 'WOOD', { GRAIN: 0, PLANK: '0.070', PLANKY: 1, WEATHER: '0.50' });
      for (const sd of [-1, 1]) OVERHEAD.push(box(world, vx1 - vx0, 0.52, 0.05, (vx0 + vx1) / 2, ridgeY + 0.3, zc + sd * vw, lv));
      for (const x of [vx0, vx1]) OVERHEAD.push(box(world, 0.05, 0.52, vw * 2, x, ridgeY + 0.3, zc, louver));
      for (let x = vx0; x <= vx1 + 0.01; x += 1.4) for (const sd of [-1, 1]) OVERHEAD.push(wbox(world, 0.09, 0.56, 0.09, x, ridgeY + 0.3, zc + sd * vw, CEDAR_DARK));
      gable(world, { x0: vx0, x1: vx1, zc, half: vw + 0.28, eaveY: ridgeY + 0.56, ridgeY: ridgeY + 0.98, over: 0.3 });
    }

    // --- 鎖樋：屋簷兩端垂下的雨鏈，落進石水缽 ---
    for (const x of [E.x0 - 0.45, E.x1 + 0.45]) {
      const top = pentEaveY - 0.12, z = pentEaveZ + 0.1;
      const cup = new THREE.CylinderGeometry(0.035, 0.018, 0.07, 8, 1, true);
      const metal = std({ color: 0x4a5a50, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
      for (let y = top; y > 0.5; y -= 0.11) mesh(world, cup, metal, x, y, z, false);
      const bowl = mesh(world, rockGeometry(rand, 20), M.stone, x, 0.2, z);
      bowl.scale.set(0.4, 0.26, 0.4);
      const wtr = mesh(world, new THREE.CircleGeometry(0.22, 20), std({ color: 0x24403f, roughness: 0.08 }), x, 0.385, z, false);
      wtr.rotation.x = -Math.PI / 2;
      L.circles.push({ x, z, r: 0.42 });
    }
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

  // ---------- 東翼：壺湯預定地（下一段才做，先用一圈石緣示意範圍） ----------
  {
    const T = L.TSUBO;
    const ring = mesh(world, new THREE.TorusGeometry(T.r, 0.11, 10, 64), M.stone, T.x, 0.04, T.z);
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.85;
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
