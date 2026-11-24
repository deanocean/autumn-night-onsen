// 開發用：量「進場」與「第一次切到夜晚」時有沒有卡頓的畫格。
// 用法：node tools/perf.js
// 印出各階段裡超過 40 ms 的畫格（時間點與長度）以及當時已編譯的 shader 數量。
// 無頭 Chrome 的絕對數字不等於使用者的機器，只用來比較改動前後。
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.m4a': 'audio/mp4' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('pageerror:', e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) console.log('console error:', m.text()); });
    await page.evaluateOnNewDocument(() => {
      Element.prototype.requestPointerLock = () => {};
      // 從頁面一開始就記錄每個畫格的間隔
      window.__frames = [];
      let last = performance.now();
      const tick = (t) => { window.__frames.push([t, t - last]); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const mark = () => page.evaluate(() => performance.now());
    const report = async (label, t0, t1) => {
      const r = await page.evaluate((t0, t1) => {
        const f = window.__frames.filter(([t]) => t >= t0 && t < t1);
        const d = f.map((x) => x[1]).sort((a, b) => a - b);
        return {
          n: f.length,
          median: d[Math.floor(d.length / 2)] || 0,
          long: f.filter((x) => x[1] > 40).map(([t, dt]) => `+${Math.round(t - t0)}ms:${Math.round(dt)}`),
          programs: window.__onsen ? window.__onsen.renderer.info.programs.length : -1,
          ready: window.__onsen ? window.__onsen.ready : undefined,
        };
      }, t0, t1);
      console.log(`${label}｜畫格 ${r.n}、中位數 ${r.median.toFixed(1)} ms、shader ${r.programs}｜超過 40 ms：${r.long.length ? r.long.join('  ') : '無'}`);
    };

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    // 有預編譯的版本：等開始按鈕可按
    await page.waitForFunction(() => !document.getElementById('start').disabled, { timeout: 60000 });
    await wait(1500);
    const tLoad = await mark();
    await report('載入（開始畫面）', 0, tLoad);

    await page.click('#start');
    await wait(4000);
    const tIn = await mark();
    await report('進場後 4 秒', tLoad, tIn);

    let tPrev = tIn;
    for (const [phase, label] of [['dusk', '第一次切到黃昏'], ['night', '第一次切到夜晚'], ['day', '切回白天'], ['dusk', '第二次切到黃昏'], ['night', '第二次切到夜晚']]) {
      await page.evaluate((p) => window.__onsen.dayNight.set(p), phase);
      await wait(8000);
      const tNow = await mark();
      await report(label, tPrev, tNow);
      tPrev = tNow;
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
