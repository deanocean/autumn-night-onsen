// 開發用：用無頭 Chrome 開啟場景並截圖，讓 Claude 不必請使用者截圖就能看畫面。
// 首次使用：cd tools && npm install
// 用法：node tools/shot.js [--dusk|--night] [--top] [--lang=zh|en|ja] [--intro] [--w=1600 --h=900] 名稱:x,z,yaw,pitch [...]
//   --lang：介面語言（預設 zh；不指定時無頭 Chrome 會照瀏覽器語言變成英文）。--intro：只拍開始畫面（檔名 intro-語言.jpg）。
//   yaw 0 朝北（-z，山谷），Math.PI 朝南（湯屋）；pitch 正值仰、負值俯。
//   不給視角時拍預設的五張。輸出在 tools/shots/（不進版本庫），檔名是「名稱-時段.jpg」（白天不加；名稱已以時段結尾也不加）。
//   每次執行會先刪掉 tools/shots/ 裡超過兩小時的舊檔，資料夾只留這一輪工作的圖；要長期保留的請另存到別處。
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
const KEEP_MS = 2 * 60 * 60 * 1000; // 舊圖保留多久
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

const DEFAULTS = [
  ['start', -5.2, 10.1, 0.12, -0.04],
  ['ground', -5.6, 6.0, 0.3, -0.75],
  ['rock', 4.2, 4.6, -0.5, -0.25],
  ['yuya', -4.5, 4.5, Math.PI, 0.12],
  ['wood', -5.2, 9.6, Math.PI - 0.5, -0.1],
];

const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find((s) => s.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const phase = args.includes('--night') ? 'night' : args.includes('--dusk') ? 'dusk' : 'day';
const top = args.includes('--top'); // 鳥瞰（等同按 M）
const intro = args.includes('--intro');
const langArg = args.find((s) => s.startsWith('--lang='));
const LANG = langArg ? langArg.slice(7) : 'zh';
const W = flag('w', 1600), H = flag('h', 900);
// --eval=程式碼：進場後、拍照前在頁面裡執行（例如熄掉某盞燈）
const evalArg = args.find((s) => s.startsWith('--eval='));
const evalCode = evalArg ? evalArg.slice(7) : '';
let views = args.filter((s) => !s.startsWith('--')).map((s) => {
  const [name, rest] = s.split(':');
  const [x, z, yaw, pitch] = rest.split(',').map(Number);
  return [name, x, z, yaw, pitch || 0];
});
if (!views.length) views = DEFAULTS;

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
  fs.mkdirSync(OUT, { recursive: true });
  // 清掉舊圖：不是整個清空，因為白天與夜晚要分兩次執行，得讓前一次的圖留著對照
  const cutoff = Date.now() - KEEP_MS;
  for (const name of fs.readdirSync(OUT)) {
    const p = path.join(OUT, name);
    if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) console.log('console error:', m.text(), m.location().url || ''); });
    page.on('pageerror', (e) => console.log('pageerror:', e.message));
    // 截圖時不要鎖定滑鼠：無頭 Chrome 的滑鼠鎖定會把使用者真正的游標拉來拉去
    await page.evaluateOnNewDocument((l) => {
      Element.prototype.requestPointerLock = () => {};
      try { localStorage.setItem('onsen-lang', l); } catch (_) { /* 無妨 */ }
    }, LANG);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => window.__onsen && window.__onsen.ready, { timeout: 60000 });
    if (intro) {
      if (evalCode) { await page.evaluate(evalCode); await wait(300); }
      const file = path.join(OUT, `intro-${LANG}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
      console.log('saved', file);
      return;
    }
    await page.click('#start');
    await wait(1500);
    if (phase !== 'day') { await page.evaluate((p) => window.__onsen.dayNight.set(p), phase); await wait(7500); }
    if (evalCode) { const r = await page.evaluate(evalCode); if (r !== undefined) console.log('eval:', JSON.stringify(r)); await wait(300); }
    if (top) await page.evaluate(() => window.__onsen.guides.setTop(true));
    for (const [name, x, z, yaw, pitch] of views) {
      await page.evaluate((x, z, yaw, pitch) => {
        const pl = window.__onsen.player;
        pl.pos.x = x; pl.pos.z = z; pl.yaw = yaw; pl.pitch = pitch; pl.vel.set(0, 0);
      }, x, z, yaw, pitch);
      await wait(1200);
      // 黃昏、夜晚在檔名後加時段；名稱本身已經以該時段結尾（如 bay-night）就不再加
      const tag = phase !== 'day' && !name.endsWith('-' + phase) ? '-' + phase : '';
      const file = path.join(OUT, `${name}${tag}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
      console.log('saved', file);
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
