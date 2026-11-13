// 障子窗貼圖：和紙底 + 夜裡從室內透光時浮現的影絵（植物剪影）。
// 日間用單純的和紙（map），影絵只畫在 emissiveMap：那是「室內的光被擋住」的樣子。
import * as THREE from 'three';

const INK = '#2a170a';

// 和紙貼圖：米白底、雲狀濃淡、細纖維絲（很淡，不能髒）。fbm／rng 由 world.js 傳入，避免循環 import。
export function paperCanvas(fbm, rng, W = 512, H = 512, seed = 77) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4ead4'; ctx.fillRect(0, 0, W, H);
  const g = 64, small = document.createElement('canvas');
  small.width = small.height = g;
  const sc = small.getContext('2d'), img = sc.createImageData(g, g);
  const o0 = seed * 3.1;
  for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) {
    const v = fbm(x * 0.13 + o0, y * 0.13, 1.7), k = (v - 0.44) * 2.2;
    const o = (y * g + x) * 4;
    img.data[o] = k > 0 ? 255 : 120; img.data[o + 1] = k > 0 ? 255 : 90; img.data[o + 2] = k > 0 ? 255 : 40;
    img.data[o + 3] = Math.min(255, Math.abs(k) * 34);
  }
  sc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W, H);
  const r = rng(seed);
  ctx.lineWidth = 1;
  const n = Math.round(700 * W * H / 262144);
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI, l = 6 + r() * 26;
    ctx.strokeStyle = r() < 0.5 ? `rgba(255,255,255,${0.25 + r() * 0.3})` : `rgba(150,115,70,${0.05 + r() * 0.07})`;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 6, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 6, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  return c;
}

// ---------- 形狀 ----------
// 細長葉（竹、薄）：從 (x,y) 朝 a 弧度伸出，長 len、寬 wid
function blade(c, x, y, a, len, wid, bend = 0) {
  const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
  const mx = x + ca * len * 0.5 + nx * bend, my = y + sa * len * 0.5 + ny * bend;
  const ex = x + ca * len + nx * bend * 1.6, ey = y + sa * len + ny * bend * 1.6;
  c.beginPath(); c.moveTo(x, y);
  c.quadraticCurveTo(mx + nx * wid, my + ny * wid, ex, ey);
  c.quadraticCurveTo(mx - nx * wid, my - ny * wid, x, y);
  c.fill();
}
// 楓葉（掌狀五裂）
function maple(c, x, y, s, rot) {
  c.save(); c.translate(x, y); c.rotate(rot);
  const tips = [[-1.5, 0.7], [-0.78, 1.0], [0, 1.05], [0.78, 1.0], [1.5, 0.7]];
  c.beginPath(); c.moveTo(0, s * 0.18);
  let pa = -2.0, pr = 0.28;
  for (const [a, l] of tips) {
    const va = a - 0.38;
    c.lineTo(Math.sin(va) * s * 0.34, -Math.cos(va) * s * 0.34);
    // 尖端：兩側各一點，做出小鋸齒
    c.lineTo(Math.sin(a - 0.12) * s * l * 0.78, -Math.cos(a - 0.12) * s * l * 0.78);
    c.lineTo(Math.sin(a) * s * l, -Math.cos(a) * s * l);
    c.lineTo(Math.sin(a + 0.12) * s * l * 0.78, -Math.cos(a + 0.12) * s * l * 0.78);
  }
  c.lineTo(Math.sin(1.9) * s * 0.3, -Math.cos(1.9) * s * 0.3);
  c.lineTo(0, s * 0.18);
  c.closePath(); c.fill();
  c.lineWidth = Math.max(1, s * 0.05); c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, s * 0.45); c.lineTo(0, s * 0.1); c.stroke();
  c.restore();
}
// 曲線枝（二次貝茲，粗細漸細）
function stem(c, pts, w0, w1) {
  const n = 28;
  const at = (t) => {
    const u = 1 - t;
    return [u * u * pts[0][0] + 2 * u * t * pts[1][0] + t * t * pts[2][0], u * u * pts[0][1] + 2 * u * t * pts[1][1] + t * t * pts[2][1]];
  };
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = at(i / n), b = at((i + 1) / n);
    c.lineWidth = w0 + (w1 - w0) * (i / n);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
  }
  return at;
}

// ---------- 各窗的圖案：座標 0..W × 0..H，y 向下；L(0)=最模糊 L(1)=中 L(2)=清楚 ----------
function bamboo(L, r, W, H) {
  const culms = [[0.2, 0.92, 0.06], [0.33, 1.0, 0.04], [0.82, 0.96, 0.03]];
  culms.forEach(([fx, dep, tw], k) => {
    const c = L(k === 1 ? 0 : k === 0 ? 1 : 0);
    const x0 = fx * W, lean = (r() - 0.5) * 0.03 * W, top = -10;
    const w = tw * W * 0.8;
    c.fillStyle = c.strokeStyle = INK;
    stem(c, [[x0, H + 10], [x0 + lean, H * 0.5], [x0 + lean * 1.6, top]], w, w * 0.75);
    // 竹節
    for (let y = H * 0.9; y > 0; y -= 95 + r() * 40) {
      const t = 1 - y / H, x = x0 + lean * 2 * t * (1 - t * 0.2);
      c.lineWidth = 3; c.beginPath(); c.moveTo(x - w * 0.9, y); c.lineTo(x + w * 0.9, y); c.stroke();
      // 節上的細枝與葉
      if (r() < 0.8 && y < H * 0.82) {
        const dir = r() < 0.5 ? -1 : 1, bl = 40 + r() * 50;
        const ex = x + dir * bl, ey = y - 14 - r() * 20;
        c.lineWidth = 2.2; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + dir * bl * 0.5, y - 4, ex, ey); c.stroke();
        const cl = L(1);
        cl.fillStyle = INK;
        const nl = 4 + Math.floor(r() * 3);
        for (let i = 0; i < nl; i++) {
          const a = (dir > 0 ? 0 : Math.PI) + dir * (0.25 + i * 0.3) + (r() - 0.5) * 0.2 + (dir > 0 ? 0.3 : -0.3);
          blade(cl, ex, ey, a, 90 + r() * 40, 8 + r() * 3, dir * 6);
        }
      }
    }
  });
}
function maple2(L, r, W, H, opt = {}) {
  // 從右上角斜垂下的楓枝
  const c = L(2); c.strokeStyle = c.fillStyle = INK;
  const at = stem(c, [[W + 20, -10], [W * 0.62, H * 0.1], [W * 0.3, H * 0.3]], 15, 3.4);
  const sub = stem(c, [[...at(0.45)], [W * 0.5, H * 0.46], [W * 0.46, H * 0.62]], 4, 1.2);
  const spots = [];
  for (const t of [0.3, 0.5, 0.68, 0.85, 1]) spots.push(at(t));
  for (const t of [0.5, 0.85, 1]) spots.push(sub(t));
  spots.forEach((p, i) => {
    const cc = L(i % 3 === 0 ? 2 : 1); cc.fillStyle = cc.strokeStyle = INK;
    const s = 48 + r() * 26, rot = (r() - 0.5) * 1.2;
    // 葉柄 + 葉往下垂
    const dx = (r() - 0.5) * 30, dy = 36 + r() * 22;
    cc.lineWidth = 2; cc.beginPath(); cc.moveTo(p[0], p[1]); cc.quadraticCurveTo(p[0] + dx * 0.3, p[1] + dy * 0.5, p[0] + dx, p[1] + dy); cc.stroke();
    maple(cc, p[0] + dx, p[1] + dy + s * 0.55, s, rot + Math.PI);
  });
  // 遠處的葉（更模糊）
  for (let i = 0; i < 4; i++) { const cc = L(0); cc.fillStyle = INK; maple(cc, W * (0.35 + r() * 0.5), H * (0.1 + r() * 0.5), 34 + r() * 20, r() * 6.28); }
  // 一片飄落的
  maple(L(1), W * 0.18, H * 0.76, 40, 0.7); L(1);
}
function susuki(L, r, W, H) {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const c = L(i % 3 === 0 ? 2 : i % 2 ? 1 : 0); c.strokeStyle = c.fillStyle = INK;
    const x0 = W * (0.52 + r() * 0.42), lean = -(0.06 + r() * 0.22) * W, top = H * (0.12 + r() * 0.3);
    const at = stem(c, [[x0, H + 10], [x0 + lean * 0.2, top + 80], [x0 + lean, top]], 4.2, 2.2);
    // 穗：細長紡錘，往下垂的一束
    const [px, py] = at(1), [qx, qy] = at(0.93), a = Math.atan2(py - qy, px - qx);
    const pl = 120 + r() * 50;
    for (let k = 0; k < 26; k++) {
      const da = (r() - 0.5) * 0.5, ll = pl * (0.55 + 0.45 * Math.cos((k / 26 - 0.5) * 2.2));
      c.globalAlpha = 0.6; c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(px - Math.cos(a) * 30, py - Math.sin(a) * 30);
      c.quadraticCurveTo(px + Math.cos(a + da) * ll * 0.5, py + Math.sin(a + da) * ll * 0.5 - 6, px + Math.cos(a + da * 1.6 + 0.5) * ll, py + Math.sin(a + da * 1.6 + 0.5) * ll + 10 + r() * 10);
      c.stroke();
    }
    c.globalAlpha = 1;
    // 葉
    const cl = L(1); cl.fillStyle = INK;
    for (let j = 0; j < 2; j++) {
      const sx = x0 + (r() - 0.5) * 12, sy = H + 5, a2 = -Math.PI / 2 + (r() - 0.5) * 0.9, len = H * (0.5 + r() * 0.25);
      blade(cl, sx, sy, a2, len, 9, (r() < 0.5 ? -1 : 1) * 40);
    }
  }
}
function pine(L, r, W, H) {
  const c = L(2); c.strokeStyle = c.fillStyle = INK;
  const at = stem(c, [[-20, H * 0.18], [W * 0.3, H * 0.1], [W * 0.78, H * 0.34]], 20, 6);
  const clumps = [[0.3, -1], [0.55, 1], [0.78, -1], [1, 0]];
  const side = stem(c, [[...at(0.55)], [W * 0.5, H * 0.52], [W * 0.62, H * 0.66]], 6, 2);
  const pts = clumps.map(([t]) => at(t)); pts.push(side(1));
  pts.forEach((p, i) => {
    const cc = L(i % 2 ? 1 : 2); cc.strokeStyle = INK; cc.lineWidth = 3.2;
    const R = 80 + r() * 25, cx = p[0], cy = p[1] + 20;
    for (let k = 0; k < 90; k++) {
      const a = Math.PI * (0.05 + 0.9 * r()) * (r() < 0.2 ? -0.5 : 1), l = R * (0.5 + 0.5 * r());
      cc.beginPath(); cc.moveTo(cx, cy); cc.lineTo(cx + Math.cos(a - Math.PI * 0.5 + 0.0) * l * 1.1 - 0, cy + Math.sin(a) * l * 0.55 - 8);
      cc.stroke();
    }
  });
  // 遠處一小叢
  const cb = L(0); cb.strokeStyle = INK; cb.lineWidth = 3;
  for (let k = 0; k < 60; k++) { const a = r() * 6.28, l = 50 + r() * 50; cb.beginPath(); cb.moveTo(W * 0.2, H * 0.78); cb.lineTo(W * 0.2 + Math.cos(a) * l, H * 0.78 + Math.sin(a) * l * 0.5); cb.stroke(); }
}
function roundWin(L, r, W, H) {
  const c = L(2); c.strokeStyle = c.fillStyle = INK;
  const at = stem(c, [[W * 0.7, -10], [W * 0.62, H * 0.12], [W * 0.5, H * 0.18]], 7, 2.2);
  [0.5, 0.8, 1].forEach((t, i) => {
    const p = at(t), cc = L(i === 1 ? 1 : 2); cc.fillStyle = cc.strokeStyle = INK;
    cc.lineWidth = 2; cc.beginPath(); cc.moveTo(p[0], p[1]); cc.lineTo(p[0] - 6, p[1] + 26); cc.stroke();
    maple(cc, p[0] - 6, p[1] + 26 + 38, 62 - i * 6, Math.PI + (r() - 0.5) * 0.6);
  });
  maple(L(1), W * 0.3, H * 0.55, 52, 0.9);
  maple(L(0), W * 0.58, H * 0.72, 44, 3.6);
  maple(L(0), W * 0.2, H * 0.28, 36, 2.2);
}

function compose(base, W, H, motif, rng, seed) {
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const layers = [mk(), mk(), mk()];
  const ctxs = layers.map((l) => { const x = l.getContext('2d'); x.fillStyle = x.strokeStyle = INK; return x; });
  motif((i) => ctxs[i], rng(seed), W, H);
  const out = mk(), o = out.getContext('2d');
  o.drawImage(base, 0, 0);
  const k = W / 1024;
  const pass = [[`blur(${5 * k}px)`, 0.9], [`blur(${1.8 * k}px)`, 0.95], [`blur(${0.6 * k}px)`, 1]];
  layers.forEach((l, i) => { o.filter = pass[i][0]; o.globalAlpha = pass[i][1]; o.drawImage(l, 0, 0); if (i < 2) o.drawImage(l, 0, 0); });
  o.filter = 'none'; o.globalAlpha = 1;
  return out;
}

const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

// 回傳 { plain, panels:[bay1,bay2,bay5,bay6 的 emissiveMap], round }
export function shojiTextures(fbm, rng) {
  const plain = tex(paperCanvas(fbm, rng, 512, 512, 77));
  const W = 1024, H = 680;
  const panelBase = (s) => paperCanvas(fbm, rng, W, H, s);
  const motifs = [pine, bamboo, susuki, maple2];
  const panels = motifs.map((m, i) => tex(compose(panelBase(81 + i), W, H, m, rng, 500 + i)));
  const round = tex(compose(paperCanvas(fbm, rng, 512, 512, 91), 512, 512, roundWin, rng, 600));
  return { plain, panels, round };
}
