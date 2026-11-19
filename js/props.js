// 燈籠與小物：春日型石燈籠、行燈、檜木桶與小凳、鹿威し、牛奶。
// 位置都來自 layout.js。每個物件的零件依材質合併成少數幾個 mesh（減少繪製次數）；
// 會在 4C 被互動或動起來的部分（每盞燈的和紙、木桶、鹿威し的竹筒、牛奶瓶）保持獨立，並從 createProps 傳回。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as L from './layout.js';
import { MATERIALS as M, wood, rockGeometry, rng, fbm, OVERHEAD } from './world.js';

const std = (o = {}) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, ...o });
const V2 = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
const lathe = (pts, seg = 24, a0 = 0, a1 = Math.PI * 2) => new THREE.LatheGeometry(V2(pts), seg, a0, a1);
// 六角的石造零件：六邊旋轉體，改成每面各自的法線（稜角分明）
function hex(pts) {
  const g = lathe(pts, 6).toNonIndexed();
  g.computeVertexNormals();
  return g;
}
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
function at(x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  const sv = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, sv);
}

// 依材質收集零件，最後每種材質合併成一個 mesh
class Batch {
  constructor() { this.map = new Map(); }
  add(mat, geo, m) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (m) g.applyMatrix4(m);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
    return this;
  }
  box(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { return this.add(mat, new THREE.BoxGeometry(w, h, d), at(x, y, z, rx, ry, rz)); }
  build(parent, shadow = true) {
    for (const [mat, list] of this.map) {
      const o = new THREE.Mesh(mergeGeometries(list), mat);
      o.castShadow = shadow; o.receiveShadow = true;
      parent.add(o);
    }
    return parent;
  }
}

// ---------- 貼圖（畫在 canvas 上） ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// 和紙：米白底加上長短不一的纖維
function washiTexture(rand) {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4e8cf'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = rand() * w, y = rand() * h, a = rand() * Math.PI, l = 6 + rand() * 26;
      ctx.strokeStyle = rand() < 0.6 ? `rgba(255,252,240,${0.10 + rand() * 0.22})` : `rgba(140,105,60,${0.04 + rand() * 0.09})`;
      ctx.lineWidth = 0.5 + rand() * 1.1;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rand() - 0.5) * 8, y + Math.sin(a) * l * 0.5 + (rand() - 0.5) * 8, x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  });
}
// 透光的濃淡：燭火的高度最亮，往上下漸暗，再疊一點紙的厚薄不均
function glowTexture(rand) {
  return canvasTex(64, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7a7a7a'); g.addColorStop(0.45, '#d8d8d8'); g.addColorStop(0.66, '#ffffff'); g.addColorStop(1, '#8c8c8c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rand() * 0.07})`;
      ctx.fillRect(rand() * w, rand() * h, 4 + rand() * 18, 2 + rand() * 6);
    }
  }, false);
}
// 竹：u 繞竹身、v 沿竹長。青竹褪成黃褐，帶縱向的細條紋與斑點
function bambooTexture(rand) {
  return canvasTex(256, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#9c9a56'); g.addColorStop(0.5, '#a9a060'); g.addColorStop(1, '#8f9150');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = rand() * w;
      ctx.fillStyle = rand() < 0.5 ? `rgba(60,70,20,${0.03 + rand() * 0.08})` : `rgba(230,215,150,${0.03 + rand() * 0.08})`;
      ctx.fillRect(x, rand() * h, 1 + rand() * 2, 40 + rand() * 260);
    }
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(50,40,20,${0.05 + rand() * 0.14})`;
      ctx.beginPath(); ctx.ellipse(rand() * w, rand() * h, 0.6 + rand() * 2.2, 1 + rand() * 5, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
}
// 手巾：生成色的棉布，兩端有藍染的橫條
function towelTexture() {
  return canvasTex(128, 512, (ctx, w, h) => {
    ctx.fillStyle = '#efe9da'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2f4673';
    for (const y of [26, 44, h - 52, h - 34]) ctx.fillRect(0, y, w, 8);
    ctx.fillRect(0, 36, w, 3); ctx.fillRect(0, h - 41, w, 3);
    for (let y = 0; y < h; y += 2) { ctx.fillStyle = `rgba(0,0,0,${0.025 + (y % 6) * 0.004})`; ctx.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { ctx.fillStyle = `rgba(255,255,255,${0.03 + (x % 6) * 0.005})`; ctx.fillRect(x, 0, 1, h); }
  });
}
// 木箱上的燒印
function brandTexture(text) {
  const t = canvasTex(512, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(42,24,12,0.82)';
    ctx.font = '700 150px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif TC", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 8);
    ctx.strokeStyle = 'rgba(42,24,12,0.7)'; ctx.lineWidth = 7;
    ctx.strokeRect(34, 30, w - 68, h - 60);
  });
  return t;
}

// 沿著側面輪廓（x, y）拉出一條有寬度的布
function ribbon(path, width) {
  const pos = [], uv = [], idx = [], d = [0];
  for (let i = 1; i < path.length; i++) d.push(d[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  path.forEach(([x, y], i) => {
    pos.push(x, y, -width / 2, x, y, width / 2);
    uv.push(0, d[i] / d[d.length - 1], 1, d[i] / d[d.length - 1]);
    if (i < path.length - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createProps(world) {
  const rand = rng(20261112);
  const washi = washiTexture(rand), glow = glowTexture(rand);
  // 每盞燈各自一份和紙材質，才能逐盞熄滅（lights.js 的 sync() 會改 emissiveIntensity）
  const paperMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: washi, emissive: 0xffb872, emissiveMap: glow, emissiveIntensity: 0.12, roughness: 1 });
  const bamboo = std({ map: bambooTexture(rand), roughness: 0.42 });
  const bambooIn = std({ color: 0xcdbf8c, roughness: 0.8 });
  const copper = std({ color: 0xb4683a, metalness: 0.65, roughness: 0.36 });
  const waterMat = std({ color: 0x9db8ae, roughness: 0.05, transparent: true, opacity: 0.78 });
  const HINOKI = wood(0xb08a5c, 1, 0, 0.1), HINOKI_X = wood(0xb08a5c, 0, 0, 0.1);
  const DARKWOOD = wood(0x4a3729, 1, 0, 0.3);

  // ---------- 春日型石燈籠 ----------
  // 由下而上：基礎、竿、中台、火袋、笠、請花與寶珠。六角的部分用 hex()，圓的部分用旋轉體
  function stoneLantern() {
    const g = new THREE.Group(), b = new Batch(), S = M.stone;
    b.add(S, hex([[0.31, 0], [0.31, 0.07], [0.26, 0.11], [0.15, 0.17], [0.11, 0.19], [0, 0.19]]));
    b.add(S, lathe([[0.105, 0.17], [0.105, 0.2], [0.085, 0.215], [0.085, 0.47], [0.099, 0.48], [0.099, 0.51], [0.085, 0.52], [0.085, 0.77], [0.105, 0.785], [0.105, 0.82]], 20));
    b.add(S, hex([[0.12, 0.8], [0.13, 0.81], [0.2, 0.87], [0.255, 0.89], [0.255, 0.95], [0, 0.95]]));
    // 火袋：六片石板，兩面開方窗、兩面刻圓（日）、兩面刻小圓（月）
    const R = 0.165, ap = R * Math.cos(Math.PI / 6), fh = 0.28, fy = 0.95, dep = 0.035;
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Shape();
      s.moveTo(-R / 2, 0); s.lineTo(R / 2, 0); s.lineTo(R / 2, fh); s.lineTo(-R / 2, fh); s.closePath();
      const hole = new THREE.Path();
      if (k % 3 === 0) { hole.moveTo(-0.045, 0.055); hole.lineTo(-0.045, 0.225); hole.lineTo(0.045, 0.225); hole.lineTo(0.045, 0.055); hole.closePath(); }
      else hole.absarc(0, fh / 2, k % 3 === 1 ? 0.047 : 0.032, 0, Math.PI * 2, true);
      s.holes.push(hole);
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      b.add(S, new THREE.ExtrudeGeometry(s, { depth: dep, bevelEnabled: false, curveSegments: 20 }), at(Math.sin(a) * (ap - dep), fy, Math.cos(a) * (ap - dep), 0, a, 0));
    }
    // 笠：簷口厚、往頂端內凹收起，六個角各有一個蕨手
    const kasa = [[0, 1.23], [0.13, 1.23], [0.36, 1.25], [0.375, 1.29]];
    for (let i = 1; i <= 8; i++) { const t = i / 8; kasa.push([0.375 - 0.295 * t, 1.29 + 0.2 * Math.pow(t, 1.8)]); }
    kasa.push([0, 1.49]);
    b.add(S, hex(kasa));
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      b.add(S, new THREE.TorusGeometry(0.034, 0.015, 8, 16), at(Math.sin(a) * 0.36, 1.315, Math.cos(a) * 0.36, 0, a - Math.PI / 2, 0));
    }
    b.add(S, lathe([[0.075, 1.48], [0.1, 1.51], [0.1, 1.53], [0.06, 1.545], [0.05, 1.56], [0.085, 1.6], [0.09, 1.64], [0.07, 1.68], [0.03, 1.715], [0, 1.74]], 20));
    b.build(g);
    const mat = paperMat();
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, fh - 0.01, 6, 1, true), mat);
    paper.position.y = fy + fh / 2;
    paper.receiveShadow = true;
    g.add(paper);
    // 點光源放在中台頂面的下方：光照得到地面與笠的底面，但不會把火袋腳邊的石台打成一片白
    return { group: g, mat, paper, glowY: fy - 0.03 };
  }

  // ---------- 行燈 ----------
  // 深色木格框、四面和紙、四支腳
  function andon() {
    const g = new THREE.Group(), b = new Batch(), W = DARKWOOD, hw = 0.125;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(W, 0.022, 0.6, 0.022, sx * hw, 0.3, sz * hw);
    for (let k = 0; k < 4; k++) {
      const ry = (k * Math.PI) / 2, x = Math.sin(ry) * hw, z = Math.cos(ry) * hw;
      b.box(W, 0.25, 0.02, 0.018, x, 0.1, z, 0, ry, 0);
      b.box(W, 0.25, 0.02, 0.018, x, 0.56, z, 0, ry, 0);
      for (const y of [0.255, 0.405]) b.box(W, 0.25, 0.008, 0.01, x, y, z, 0, ry, 0);
      b.box(W, 0.008, 0.45, 0.01, x, 0.33, z, 0, ry, 0);
    }
    b.box(W, 0.25, 0.012, 0.25, 0, 0.096, 0);
    // 上蓋：比框身略大的薄板，中央留散熱口的框
    b.box(W, 0.3, 0.014, 0.3, 0, 0.607, 0);
    b.box(W, 0.12, 0.012, 0.12, 0, 0.62, 0);
    b.build(g);
    const mat = paperMat();
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.238, 0.45, 0.238), mat);
    paper.position.y = 0.33;
    paper.receiveShadow = true;
    g.add(paper);
    return { group: g, mat, paper, glowY: 0.33 };
  }

  // ---------- 足元灯 ----------
  // 躺椅旁的矮燈：寬大的鐵笠把往上的光全遮住，底下細木格子圍著和紙燈筒，光只落在腳邊
  function ashimoto() {
    const g = new THREE.Group(), b = new Batch();
    const iron = std({ color: 0x1b1917, roughness: 0.5, metalness: 0.55 });
    b.add(M.stone, lathe([[0, 0], [0.085, 0], [0.085, 0.022], [0.07, 0.034], [0, 0.034]], 28));
    b.add(iron, new THREE.CylinderGeometry(0.058, 0.058, 0.012, 28), at(0, 0.04, 0));
    const n = 14, rr = 0.054;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      b.box(DARKWOOD, 0.007, 0.215, 0.011, Math.sin(a) * rr, 0.152, Math.cos(a) * rr, 0, a, 0);
    }
    b.add(iron, new THREE.TorusGeometry(rr, 0.004, 6, 28), at(0, 0.2, 0, Math.PI / 2));
    // 笠：淺淺的圓錐，簷口略厚；頂上一個小鈕
    b.add(iron, lathe([[0, 0.262], [0.15, 0.262], [0.154, 0.268], [0.15, 0.276], [0.03, 0.31], [0.012, 0.316], [0.012, 0.335], [0, 0.338]], 36));
    b.build(g);
    const mat = paperMat();
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.21, 24, 1, true), mat);
    paper.position.y = 0.152;
    paper.receiveShadow = true;
    g.add(paper);
    return { group: g, mat, paper, glowY: 0.13 };
  }

  const lanterns = L.LANTERNS.map(([x, z, kind]) => {
    const y0 = L.groundY(x, z);
    const o = kind === 'stone' ? stoneLantern() : kind === 'andon' ? andon() : ashimoto();
    const s = kind === 'stone' ? 0.9 : kind === 'ashimoto' ? 1.25 : 1;
    o.group.scale.setScalar(s);
    if (kind === 'stone') {
      // 石燈籠久立土中：略微下沉、微微歪斜，每座朝向不同
      o.group.position.set(x, y0 - 0.02, z);
      o.group.rotation.set((rand() - 0.5) * 0.03, rand() * Math.PI, (rand() - 0.5) * 0.03);
    } else {
      o.group.position.set(x, y0, z);
      o.group.rotation.y = (rand() - 0.5) * 0.25;
    }
    world.add(o.group);
    return { x, y: o.group.position.y + o.glowY * s, z, kind, mat: o.mat, group: o.group, paper: o.paper };
  });

  // ---------- 檜木桶、小凳與手巾 ----------
  const P = L.PROPS;
  const oke = new THREE.Group();
  {
    const b = new Batch(), n = 14, r0 = 0.118, r1 = 0.13, h = 0.12, t = 0.011, gap = 0.012;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, d = (rand() - 0.5) * 0.0015; // 每片桶板厚薄略有出入
      b.add(HINOKI, lathe([[r0 - t, 0], [r0 + d, 0], [r1 + d, h], [r1 - t, h], [r0 - t, 0.016]], 2, a + gap / 2, (Math.PI * 2) / n - gap));
    }
    b.add(HINOKI_X, new THREE.CylinderGeometry(r0 - t + 0.002, r0 - t + 0.002, 0.012, 28), at(0, 0.012, 0));
    for (const y of [0.028, 0.084]) {
      const ra = r0 + (r1 - r0) * ((y - 0.007) / h) + 0.0018, rb = r0 + (r1 - r0) * ((y + 0.007) / h) + 0.0018;
      b.add(copper, new THREE.CylinderGeometry(rb, ra, 0.014, 40, 1, true), at(0, y, 0));
    }
    b.build(oke);
    const w = new THREE.Mesh(new THREE.CircleGeometry(r1 - t - 0.004, 28), waterMat);
    w.rotation.x = -Math.PI / 2; w.position.y = 0.072;
    oke.add(w);
    oke.userData.water = w;
    oke.position.set(P.oke.x, L.groundY(P.oke.x, P.oke.z), P.oke.z);
    oke.rotation.y = 0.6;
    world.add(oke);
  }
  const stool = new THREE.Group();
  {
    const b = new Batch();
    b.box(HINOKI_X, 0.32, 0.03, 0.2, 0, 0.2, 0);
    for (const sx of [-1, 1]) b.box(HINOKI, 0.025, 0.185, 0.18, sx * 0.13, 0.0925, 0);
    b.box(HINOKI_X, 0.24, 0.05, 0.02, 0, 0.13, 0);
    b.build(stool);
    const cloth = std({ map: towelTexture(), roughness: 1, side: THREE.DoubleSide });
    const y = 0.2165;
    // 對折的手巾：平放在凳面，一端垂在凳邊
    const t1 = new THREE.Mesh(ribbon([[-0.1, y], [0.1, y], [0.15, y], [0.164, y - 0.006], [0.171, y - 0.022], [0.173, y - 0.07], [0.176, y - 0.13]], 0.115), cloth);
    const t2 = new THREE.Mesh(ribbon([[-0.1, y], [-0.106, y + 0.003], [-0.1, y + 0.006], [0.1, y + 0.006], [0.152, y + 0.006], [0.169, y - 0.002], [0.178, y - 0.022], [0.181, y - 0.085]], 0.115), cloth);
    for (const m of [t1, t2]) { m.castShadow = true; m.receiveShadow = true; stool.add(m); }
    stool.position.set(P.stool.x, L.groundY(P.stool.x, P.stool.z), P.stool.z);
    stool.rotation.y = P.stool.rot;
    world.add(stool);
  }

  // ---------- 鹿威し ----------
  // 局部座標：竹筒沿 x，筒口朝 +x。筧（注水竹管）在筒口上方，筒口傾倒時把水倒進蹲踞石缽，筒尾落下敲石
  const shishi = new THREE.Group();
  const pivot = new THREE.Group();
  const REST = 0.38; // 靜止時筒口仰起的角度；4C 的動畫在 REST 與負角之間擺動
  {
    const b = new Batch(), px = -0.2, py = 0.42;
    const tube = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    // 支架：兩支竹柱夾住轉軸
    for (const sz of [-1, 1]) {
      b.add(bamboo, tube(0.022, 0.56), at(px, 0.26, sz * 0.066));
      b.add(bamboo, new THREE.TorusGeometry(0.0225, 0.004, 6, 14), at(px, 0.3, sz * 0.066, Math.PI / 2));
    }
    b.add(DARKWOOD, tube(0.007, 0.19, 8), at(px, py, 0, Math.PI / 2));
    // 筧：直立的竹柱與橫出的細竹管
    const kx = px + 0.5 * Math.cos(REST) - 0.015, kz = -0.34;
    b.add(bamboo, tube(0.036, 0.86, 16), at(kx, 0.41, kz));
    for (const y of [0.2, 0.52, 0.8]) b.add(bamboo, new THREE.TorusGeometry(0.0368, 0.005, 6, 18), at(kx, y, kz, Math.PI / 2));
    b.add(bambooIn, new THREE.CircleGeometry(0.03, 14), at(kx, 0.841, kz, -Math.PI / 2));
    b.add(bamboo, new THREE.CylinderGeometry(0.015, 0.015, 0.46, 12, 1, true), at(kx, 0.735, kz + 0.17, Math.PI / 2 - 0.07));
    // 敲擊石：頂面剛好接住靜止時的筒尾
    const tailX = px - 0.28 * Math.cos(REST), tailY = py - 0.3 * Math.sin(REST) - 0.036;
    const sg = rockGeometry(rand, 14);
    sg.computeBoundingBox();
    const sTop = sg.boundingBox.max.y;
    const stone = new THREE.Mesh(sg, M.rock);
    stone.scale.set(0.2, (tailY + 0.06) / sTop, 0.17);
    stone.position.set(tailX - 0.02, -0.06, 0);
    stone.rotation.y = 0.7;
    stone.castShadow = stone.receiveShadow = true;
    shishi.add(stone);
    // 蹲踞石缽：旋轉體用雜訊推出不規則的石形
    const bx = px + 0.72;
    const bg = lathe([[0, 0], [0.22, 0], [0.275, 0.07], [0.27, 0.15], [0.24, 0.185], [0.205, 0.18], [0.18, 0.13], [0.1, 0.09], [0, 0.085]], 30);
    const bp = bg.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const k = 1 + (fbm(x * 4 + 3, y * 4, z * 4 + 8) - 0.44) * 0.3;
      bp.setXYZ(i, x * k, y * (1 + (fbm(x * 5, 2, z * 5) - 0.44) * 0.18), z * k);
    }
    bg.computeVertexNormals();
    const basin = new THREE.Mesh(bg, M.stone);
    basin.position.set(bx, -0.01, 0.02);
    basin.castShadow = basin.receiveShadow = true;
    shishi.add(basin);
    const bw = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), waterMat);
    bw.rotation.x = -Math.PI / 2; bw.position.set(bx, 0.145, 0.02);
    shishi.add(bw);
    b.build(shishi);

    // 竹筒：獨立在轉軸群組裡。筒口斜切、開口朝上；筒尾有節封住
    const pb = new Batch(), r = 0.036, x0 = -0.3, x1 = 0.5;
    const tg = new THREE.CylinderGeometry(r, r, x1 - x0, 18, 6, true);
    tg.rotateZ(-Math.PI / 2); // 圓柱的 +y 轉到 +x
    tg.translate((x0 + x1) / 2, 0, 0);
    const tp = tg.attributes.position;
    for (let i = 0; i < tp.count; i++) if (tp.getX(i) > x1 - 0.01) tp.setX(i, x1 - (tp.getY(i) / r + 1) * 0.5 * 0.1);
    tg.computeVertexNormals();
    const tm = bamboo.clone();
    tm.side = THREE.DoubleSide;
    pb.add(tm, tg);
    for (const x of [x0 + 0.015, x0 + 0.29, x0 + 0.56]) pb.add(bamboo, new THREE.TorusGeometry(r + 0.0008, 0.0045, 6, 20), at(x, 0, 0, 0, Math.PI / 2));
    pb.add(bambooIn, new THREE.CircleGeometry(r - 0.001, 16), at(x0, 0, 0, 0, -Math.PI / 2));
    pb.add(bambooIn, new THREE.CircleGeometry(r - 0.003, 16), at(x0 + 0.56, 0, 0, 0, Math.PI / 2));
    pb.build(pivot);
    pivot.position.set(px, py, 0);
    pivot.rotation.z = REST;
    shishi.add(pivot);
    shishi.userData.spout = new THREE.Vector3(kx, 0.72, 0.02); // 筧的出水口（局部座標），4C 的水柱從這裡落下

    shishi.position.set(P.shishi.x, L.groundY(P.shishi.x, P.shishi.z), P.shishi.z);
    shishi.rotation.y = P.shishi.rot;
    shishi.scale.setScalar(1.2);
    world.add(shishi);
  }

  // ---------- 牛奶 ----------
  // 簷廊上的小木箱，裡面三瓶：牛奶、咖啡牛奶、水果牛奶
  const milk = new THREE.Group();
  const bottles = [];
  {
    const b = new Batch(), cw = 0.36, cd = 0.25, t = 0.012;
    b.box(HINOKI_X, cw, t, cd, 0, t / 2, 0);
    b.box(HINOKI_X, cw, 0.115, t, 0, 0.0575 + t, -cd / 2 + t / 2);
    for (const y of [0.04, 0.1]) {
      b.box(HINOKI_X, cw, 0.045, t, 0, y, cd / 2 - t / 2);
      for (const sx of [-1, 1]) b.box(wood(0xb08a5c, 2, 0, 0.1), t, 0.045, cd - t * 2, sx * (cw / 2 - t / 2), y, 0);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(HINOKI, 0.02, 0.115, 0.02, sx * (cw / 2 - t - 0.01), 0.0575 + t, sz * (cd / 2 - t - 0.01));
    b.build(milk);
    const brand = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.085), new THREE.MeshStandardMaterial({ map: brandTexture('牛乳'), transparent: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    brand.rotation.y = Math.PI;
    brand.position.set(0, 0.07, -cd / 2 - 0.0008);
    milk.add(brand);

    const glassGeo = lathe([[0, 0], [0.028, 0], [0.03, 0.008], [0.03, 0.095], [0.026, 0.115], [0.0175, 0.136], [0.0165, 0.154], [0.0188, 0.157], [0.0188, 0.164], [0.015, 0.164]], 24);
    const liquidGeo = lathe([[0, 0.005], [0.0268, 0.005], [0.0272, 0.094], [0.0235, 0.113], [0.0155, 0.132], [0, 0.132]], 24);
    const capGeo = new THREE.CylinderGeometry(0.0182, 0.0182, 0.004, 20);
    const glass = std({ color: 0xe4f1ec, roughness: 0.04, transparent: true, opacity: 0.3, depthWrite: false });
    [[-0.105, 0xf8f4ea, 0x5f7fb5], [0, 0xb38a62, 0x8a5a3a], [0.105, 0xf3dc98, 0xd98a4a]].forEach(([x, liquidCol, capCol], i) => {
      const g = new THREE.Group();
      const liquid = new THREE.Mesh(liquidGeo, std({ color: liquidCol, roughness: 0.35 }));
      const shell = new THREE.Mesh(glassGeo, glass);
      const cap = new THREE.Mesh(capGeo, std({ color: capCol, roughness: 0.9 }));
      cap.position.y = 0.165;
      shell.renderOrder = 2;
      liquid.castShadow = shell.castShadow = true;
      g.add(liquid, shell, cap);
      g.position.set(x, t, (i - 1) * 0.012 + 0.02);
      milk.add(g);
      bottles.push({ group: g, liquid, glass: shell, cap });
    });
    // 木箱放在一張小台上，站著也看得到、拿得到
    const stand = new THREE.Group(), sb = new Batch(), sh = 0.4;
    sb.box(HINOKI_X, 0.46, 0.025, 0.32, 0, sh - 0.0125, 0);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) sb.box(HINOKI, 0.03, sh - 0.025, 0.03, sx * 0.19, (sh - 0.025) / 2, sz * 0.125);
      sb.box(wood(0xb08a5c, 2, 0, 0.1), 0.02, 0.035, 0.25, sx * 0.19, 0.12, 0);
    }
    for (const sz of [-1, 1]) sb.box(HINOKI_X, 0.38, 0.035, 0.02, 0, sh - 0.045, sz * 0.125);
    sb.build(stand);
    stand.position.set(P.milk.x, L.ENGAWA.y, P.milk.z);
    stand.rotation.y = P.milk.rot;
    world.add(stand);
    milk.position.set(P.milk.x, L.ENGAWA.y + sh, P.milk.z);
    milk.rotation.y = P.milk.rot;
    world.add(milk);
  }

  // ---------- 躺椅與小几（西翼） ----------
  // 局部座標：椅身沿 z，腳在 -z、頭在 +z。三段：腿托、座面、靠背，各自兩根側框加橫條，上面鋪一張薄墊
  const chair = new THREE.Group();
  const LG = L.LOUNGE;
  {
    const b = new Batch(), hw = 0.29;
    const FRAME = wood(0xa88458, 2, 0, 0.15), SLAT = wood(0xb08a5c, 0, 0, 0.12), LEG = wood(0xa88458, 1, 0, 0.15);
    const mat = std({ color: 0xd9cfba, roughness: 1 }), pillow = std({ color: 0x2c3f63, roughness: 1 });
    const pts = [[-0.95, 0.25], [-0.3, 0.36], [0.2, 0.3], [0.94, 0.73]]; // [z, y]：腳端、膝、腰、頭端
    for (let i = 0; i < 3; i++) {
      const [z0, y0] = pts[i], [z1, y1] = pts[i + 1];
      const len = Math.hypot(z1 - z0, y1 - y0), a = Math.atan2(y1 - y0, z1 - z0), zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
      const dy = Math.sin(a), dz = Math.cos(a), ny = Math.cos(a), nz = -Math.sin(a);
      for (const sx of [-1, 1]) b.box(FRAME, 0.04, 0.065, len + 0.03, sx * hw, yc, zc, -a);
      const n = Math.round(len / 0.095);
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) / n - 0.5) * len;
        b.box(SLAT, hw * 2 + 0.04, 0.018, 0.07, 0, yc + dy * s + ny * 0.041, zc + dz * s + nz * 0.041, -a);
      }
      b.box(mat, hw * 2 - 0.06, 0.04, len - 0.03, 0, yc + ny * 0.07, zc + nz * 0.07, -a);
    }
    // 枕：靠背上端一個藍染的小圓枕
    b.add(pillow, new THREE.CylinderGeometry(0.065, 0.065, 0.36, 16), at(0, 0.73, 0.69, 0, 0, Math.PI / 2));
    // 腳：前腳、腰下的腳、撐住靠背的後腳，左右各一；腰下一根橫撐
    for (const sx of [-1, 1]) {
      b.box(LEG, 0.045, 0.27, 0.05, sx * hw, 0.135, -0.78);
      b.box(LEG, 0.045, 0.3, 0.05, sx * hw, 0.15, 0.2);
      b.box(LEG, 0.045, 0.56, 0.05, sx * hw, 0.28, 0.7);
      b.box(FRAME, 0.04, 0.045, 0.5, sx * hw, 0.12, 0.45);
      // 扶手
      b.box(LEG, 0.04, 0.22, 0.04, sx * (hw + 0.045), 0.44, -0.12);
      b.box(FRAME, 0.07, 0.025, 0.66, sx * (hw + 0.045), 0.56, 0.16);
      b.box(LEG, 0.04, 0.12, 0.04, sx * (hw + 0.045), 0.5, 0.44);
    }
    b.box(SLAT, hw * 2, 0.045, 0.04, 0, 0.12, 0.2);
    b.box(SLAT, hw * 2, 0.045, 0.04, 0, 0.12, 0.7);
    b.build(chair);
    chair.position.set(LG.chair.x, LG.y, LG.chair.z);
    chair.rotation.y = LG.chair.rot;
    world.add(chair);

    // 小几：圓几上一只漆盆，放著鐵壺與茶杯
    const table = new THREE.Group(), tb = new Batch(), th = 0.44;
    const lacquer = std({ color: 0x3a1512, roughness: 0.35 }), iron = std({ color: 0x1c1b1a, roughness: 0.55, metalness: 0.4 });
    const cup = std({ color: 0x8a9684, roughness: 0.4 }), tea = std({ color: 0x6f7a2a, roughness: 0.15 });
    tb.add(HINOKI_X, new THREE.CylinderGeometry(0.21, 0.21, 0.028, 32), at(0, th - 0.014, 0));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      tb.add(HINOKI, new THREE.CylinderGeometry(0.016, 0.02, th - 0.02, 10), at(Math.cos(a) * 0.14, (th - 0.03) / 2, Math.sin(a) * 0.14, Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12));
    }
    tb.add(HINOKI_X, new THREE.TorusGeometry(0.12, 0.009, 6, 24), at(0, 0.16, 0, Math.PI / 2));
    tb.add(lacquer, lathe([[0, th], [0.15, th], [0.158, th + 0.014], [0.15, th + 0.016], [0.145, th + 0.008], [0, th + 0.008]], 32));
    // 鐵壺
    tb.add(iron, lathe([[0, 0], [0.04, 0], [0.058, 0.02], [0.062, 0.045], [0.05, 0.07], [0.03, 0.078], [0.03, 0.084], [0.012, 0.088], [0.012, 0.1], [0, 0.102]], 20), at(-0.04, th + 0.008, -0.03));
    tb.add(iron, new THREE.CylinderGeometry(0.007, 0.011, 0.05, 8), at(-0.04 + 0.068, th + 0.06, -0.03, 0, 0, -0.9));
    tb.add(iron, new THREE.TorusGeometry(0.045, 0.004, 6, 20, Math.PI), at(-0.04, th + 0.078, -0.03, 0, Math.PI / 2, 0));
    // 茶杯與茶
    tb.add(cup, lathe([[0, 0], [0.022, 0], [0.03, 0.012], [0.034, 0.055], [0.03, 0.055], [0.027, 0.014], [0, 0.01]], 20), at(0.07, th + 0.008, 0.05));
    tb.add(tea, new THREE.CircleGeometry(0.029, 20), at(0.07, th + 0.008 + 0.044, 0.05, -Math.PI / 2));
    tb.build(table);
    table.position.set(LG.table.x, LG.y, LG.table.z);
    table.rotation.y = 0.4;
    world.add(table);

    // 野点傘：朱紅的大和傘，深色竹柄插在木座上
    const para = new THREE.Group(), pb = new Batch(), PR = LG.parasol.r, rimY = 2.02, apexY = 2.34, N = 28;
    const paper = std({ color: 0xb3261c, roughness: 0.75, side: THREE.DoubleSide });
    const dark = std({ color: 0x1d1512, roughness: 0.6 });
    const cg = new THREE.ConeGeometry(PR, apexY - rimY, N, 1, true).toNonIndexed();
    cg.computeVertexNormals();
    const canopy = new THREE.Mesh(cg, paper);
    canopy.position.y = (rimY + apexY) / 2;
    canopy.castShadow = canopy.receiveShadow = true;
    para.add(canopy);
    const slope = Math.atan2(apexY - rimY, PR), sl = Math.hypot(PR, apexY - rimY);
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      // 親骨（貼著傘面內側）與小骨（從柄上的轆轤撐到親骨中段）
      pb.add(dark, new THREE.BoxGeometry(sl, 0.008, 0.008), at(c * PR / 2, (rimY + apexY) / 2 - 0.012, sn * PR / 2, 0, -a, -slope));
      const mx = PR * 0.52, my = apexY - (apexY - rimY) * 0.52 - 0.02, hubY = 1.84;
      pb.add(dark, new THREE.BoxGeometry(Math.hypot(mx - 0.03, my - hubY), 0.006, 0.006), at(c * (mx + 0.03) / 2, (my + hubY) / 2, sn * (mx + 0.03) / 2, 0, -a, Math.atan2(my - hubY, mx - 0.03)));
    }
    pb.add(dark, new THREE.CylinderGeometry(0.019, 0.022, apexY + 0.04, 12), at(0, (apexY + 0.04) / 2, 0));
    pb.add(dark, new THREE.CylinderGeometry(0.04, 0.04, 0.05, 14), at(0, 1.84, 0));
    pb.add(dark, new THREE.ConeGeometry(0.05, 0.07, 14), at(0, apexY + 0.03, 0));
    pb.box(DARKWOOD, 0.3, 0.07, 0.3, 0, 0.035, 0);
    pb.box(DARKWOOD, 0.12, 0.12, 0.12, 0, 0.1, 0);
    pb.build(para);
    para.position.set(LG.parasol.x, LG.y, LG.parasol.z);
    world.add(para);
    OVERHEAD.push(canopy);
  }

  return {
    lanterns,
    lounge: { group: chair },
    oke: { group: oke, water: oke.userData.water },
    stool,
    shishi: { group: shishi, pivot, rest: REST, spout: shishi.userData.spout },
    milk: { group: milk, bottles },
  };
}
