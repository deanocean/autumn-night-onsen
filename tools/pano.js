// 開發用：不開瀏覽器，直接用 terrain.js 的高度函式畫出「從望景台看出去的山形剪影」與「俯視地圖」。
// 調整地形（山脊、水域、聚落位置）時用它快速看構圖，一次不到兩秒；定案後再用 shot.js 看真正的畫面。
// 用法：node tools/pano.js        輸出 tools/shots/pano.png（方位 ±70 度、每度 12 像素；橫線是視平線）
//                                      tools/shots/map.png（--map=半徑公尺，預設 12000；北在上，紅點是聚落）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, 'shots');
const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };

function writeBmp(file, w, h, rgb) {
  const row = (w * 3 + 3) & ~3, buf = Buffer.alloc(54 + row * h);
  buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(w, 18); buf.writeInt32LE(-h, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 3, d = 54 + y * row + x * 3;
    buf[d] = rgb[s + 2]; buf[d + 1] = rgb[s + 1]; buf[d + 2] = rgb[s];
  }
  const bmp = file.replace(/\.png$/, '.bmp');
  fs.writeFileSync(bmp, buf);
  execFileSync('sips', ['-s', 'format', 'png', bmp, '--out', file], { stdio: 'ignore' });
  fs.unlinkSync(bmp);
}

(async () => {
  // 這台的 node 把 .js 當 CommonJS：複製成 .mjs 再載入
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, '_terrain.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'js', 'terrain.js'), tmp);
  const T = await import(tmp + '?' + Date.now());
  const { heightAt, SEA, TOWNS } = T;
  const R_MAX = T.R_MAX || 12400;
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();

  // ---------- 剪影 ----------
  {
    const PPD = 12, AZ = 70, UP = 12, DOWN = 16;
    const W = AZ * 2 * PPD, H = (UP + DOWN) * PPD, img = new Uint8Array(W * H * 3);
    const EYE = [0, 1.85, -11];
    const sky = [205, 219, 232], haze = [176, 196, 220];
    for (let px = 0; px < W; px++) {
      const az = ((px + 0.5) / PPD - AZ) * Math.PI / 180, dx = Math.sin(az), dz = -Math.cos(az);
      let top = H; // 目前畫到的最高列（越小越高）
      let hPrev = heightAt(EYE[0], EYE[2]);
      for (let r = 25, step = 4; r < R_MAX; r += step, step = Math.max(4, r * 0.012)) {
        const x = EYE[0] + dx * r, z = EYE[2] + dz * r, h0 = heightAt(x, z), h = Math.max(h0, SEA);
        const el = Math.atan2(h - EYE[1], r) * 180 / Math.PI;
        const row = Math.max(0, Math.round((UP - el) * PPD));
        if (row < top) {
          const fog = 1 - Math.exp(-r / 16000);
          let c;
          if (h0 < SEA) c = [40, 78, 130];
          else {
            const slope = (h0 - hPrev) / step; // 朝觀看者的坡較亮
            const l = Math.max(0.55, Math.min(1.25, 0.85 + slope * 0.5));
            c = [92 * l, 70 * l, 38 * l];
          }
          for (let y = row; y < top; y++) for (let k = 0; k < 3; k++) img[(y * W + px) * 3 + k] = c[k] + (haze[k] - c[k]) * fog;
          top = row;
        }
        hPrev = h0;
      }
      for (let y = 0; y < top; y++) for (let k = 0; k < 3; k++) img[(y * W + px) * 3 + k] = sky[k];
      const hr = UP * PPD; // 視平線
      if (px % 4 < 2) for (let k = 0; k < 3; k++) img[(hr * W + px) * 3 + k] = 255;
      if (Math.abs(((px / PPD) % 10) - 0) < 0.1) for (let y = 0; y < 8; y++) for (let k = 0; k < 3; k++) img[(y * W + px) * 3 + k] = 0;
    }
    writeBmp(path.join(OUT, 'pano.png'), W, H, img);
  }

  // ---------- 俯視地圖 ----------
  {
    const R = arg('map', 12000), N = 900, img = new Uint8Array(N * N * 3), m = (R * 2) / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -R + (i + 0.5) * m, z = -R * 1.7 + (j + 0.5) * m; // 往北多看一些
      const h = heightAt(x, z);
      let c;
      if (h < SEA) c = [50, 90, 140];
      else {
        const l = 0.75 + Math.max(-0.35, Math.min(0.45, (heightAt(x - m, z - m) - h) / m * 0.9));
        const t = Math.min(1, (h - SEA) / 900);
        c = [(70 + 150 * t) * l, (95 + 90 * t) * l, (50 + 60 * t) * l];
      }
      for (let k = 0; k < 3; k++) img[(j * N + i) * 3 + k] = c[k];
    }
    const dot = (x, z, r, col) => {
      const ci = (x + R) / m, cj = (z + R * 1.7) / m;
      for (let j = Math.floor(cj - r); j <= cj + r; j++) for (let i = Math.floor(ci - r); i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N || Math.hypot(i - ci, j - cj) > r) continue;
        for (let k = 0; k < 3; k++) img[(j * N + i) * 3 + k] = col[k];
      }
    };
    for (const [x, z, r] of TOWNS) dot(x, z, Math.max(2, r / m * 0.5), [230, 60, 50]);
    dot(0, 0, 4, [255, 255, 255]);
    writeBmp(path.join(OUT, 'map.png'), N, N, img);
  }
  console.log(`pano.png / map.png 已輸出（${Date.now() - t0} ms）`);
})();
