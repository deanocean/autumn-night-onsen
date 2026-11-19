import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createProps } from './props.js';
import { createTrees } from './trees.js';
import { createWater } from './water.js';
import { createSteam } from './steam.js';
import { createSky } from './sky.js';
import { createVista, slopeTreeSpots, ridgeTreeSpots } from './vista.js';
import { createLights } from './lights.js';
import { createDayNight } from './daynight.js';
import { createGuides } from './labels.js';
import { createViews } from './views.js';
import { Player } from './player.js';
import { createInteract } from './interact.js';
import { createAudio } from './audio.js';
import { G } from './env.js';
import { texturesReady } from './shaders.js';

const canvas = document.getElementById('scene');
const intro = document.getElementById('intro');
const resume = document.getElementById('resume');
const errBox = document.getElementById('err');
const timeBtn = document.getElementById('time');
const helpBtn = document.getElementById('helpbtn');
const soundBtn = document.getElementById('sound');
const startBtn = document.getElementById('start');

function fail(msg) {
  errBox.textContent = msg;
  errBox.hidden = false;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  fail('這個瀏覽器無法啟動 WebGL，請改用桌機版 Chrome、Edge 或 Safari。');
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfdbe8, 70, 600);

const hemi = new THREE.HemisphereLight(0xcfe0f5, 0x8a7862, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(68, 1, 0.08, 70000);

const { world, lamps } = buildWorld(scene);
const props = createProps(world);
const trees = createTrees(scene, world, [...slopeTreeSpots(), ...ridgeTreeSpots()]);
const water = createWater(scene);
const steam = createSteam(scene);
const sky = createSky(scene, renderer);
const vista = createVista(scene, { sun, hemi });
const lights = createLights(scene, props.lanterns, lamps);
const dayNight = createDayNight({ scene, renderer, sun, hemi, sky, lights });
const guides = createGuides(scene);
const player = new Player(camera, canvas);
const views = createViews({ camera, player, guides });
const audio = createAudio({ camera, player });
const interact = createInteract({ scene, world, camera, player, props, lights, trees, water, sky, guides, audio });

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  water.resize(w, h);
  guides.resize(w, h);
}
addEventListener('resize', resize);
resize();

// 白天 → 黃昏 → 夜晚 → 白天；按鈕上寫的是下一個時段
const NEXT_LABEL = { day: '切換到黃昏', dusk: '切換到夜晚', night: '切換到白天' };
function toggleTime() {
  timeBtn.textContent = NEXT_LABEL[dayNight.next()];
}

startBtn.addEventListener('click', () => {
  intro.classList.add('hide');
  player.enabled = true;
  timeBtn.hidden = false;
  helpBtn.hidden = false;
  soundBtn.hidden = false;
  audio.start();
  player.lock();
  canvas.focus();
});
function showSound() {
  soundBtn.textContent = audio.muted ? '聲音：關' : '聲音：開';
  soundBtn.setAttribute('aria-pressed', audio.muted ? 'false' : 'true');
}
showSound();
function toggleSound() { audio.toggleMute(); showSound(); }

timeBtn.addEventListener('click', () => { toggleTime(); timeBtn.blur(); });
soundBtn.addEventListener('click', () => { toggleSound(); soundBtn.blur(); });
helpBtn.addEventListener('click', () => { interact.key('KeyH'); helpBtn.blur(); });

// 開發者面板（` 鍵）：第一次打開時才載入 dev.js；開著的時候不鎖定滑鼠（可按住拖曳轉視角）
let dev = null, devLoading = false;
const devOpen = () => !!dev && dev.open;
async function toggleDev() {
  if (devLoading) return;
  if (!dev) {
    devLoading = true;
    try {
      const { createDev } = await import('./dev.js');
      dev = createDev({ renderer, scene, camera, sun, hemi, dayNight, lights, sky, vista, trees, water, steam, views, player, audio });
    } catch (e) { console.error(e); } finally { devLoading = false; }
  } else dev.toggle();
  if (devOpen()) { if (document.pointerLockElement) document.exitPointerLock(); resume.hidden = true; }
  else { player.lock(); canvas.focus(); }
}

canvas.tabIndex = 0;
canvas.addEventListener('click', () => {
  if (player.enabled && !devOpen() && document.pointerLockElement !== canvas) player.lock();
});
document.addEventListener('pointerlockchange', () => {
  resume.hidden = !player.enabled || devOpen() || document.pointerLockElement === canvas;
});

addEventListener('keydown', (e) => {
  if (!player.enabled || e.repeat) return;
  if (e.target.closest && e.target.closest('.dev-panel')) return; // 在面板裡打字
  // 美式鍵盤是 Tab 上面那顆；日文（JIS）鍵盤沒有這顆，` 要按 Shift + @（P 右邊），所以也看輸入的字元
  if (e.code === 'Backquote' || e.key === '`' || e.key === '｀') { toggleDev(); return; }
  if (e.code === 'KeyT') toggleTime();
  // 觀景點：V 下一個；觀景中按移動鍵回到原位，其他的鍵（除了 T、N、H）先不理
  if (e.code === 'KeyV' && !guides.top && !interact.mode && !player.anchor) views.next();
  if (views.active) {
    if (/^(Key[WASD]|Arrow)/.test(e.code)) views.exit();
    if (e.code === 'KeyN') toggleSound();
    if (e.code === 'KeyH' || e.code === 'Escape') interact.key(e.code);
    return;
  }
  if (e.code === 'KeyM') guides.toggleTop();
  if (e.code === 'KeyL') guides.toggleLabels();
  if (e.code === 'KeyN') toggleSound();
  interact.key(e.code);
});

const clock = new THREE.Clock();

// 暖機：在開始畫面就把所有 shader 編好、貼圖送進顯示卡，進場與第一次切到夜晚時才不會頓。
// 做法是把平常隱藏的東西（發亮的殼、水珠、流星、標籤……）暫時全部打開、關掉視錐剔除，
// 在夜晚、黃昏、白天各實際畫一次（含陰影與水面倒影），再還原。整段在同一個工作裡完成，
// 瀏覽器只會顯示最後那張正常的畫面。
async function warmUp() {
  await Promise.race([texturesReady(), new Promise((r) => setTimeout(r, 20000))]);
  try { await renderer.compileAsync(scene, camera); } catch (e) { console.warn(e); }
  const hidden = [], culled = [];
  scene.traverse((o) => {
    if (!o.visible) { hidden.push(o); o.visible = true; }
    if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
  });
  for (const phase of ['night', 'dusk', 'day']) {
    dayNight.set(phase, true);
    sky.update(0, camera);
    vista.update(0);
    renderer.render(scene, camera);
  }
  hidden.forEach((o) => { o.visible = false; });
  culled.forEach((o) => { o.frustumCulled = true; });
  renderer.render(scene, camera);
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  G.uTime.value += dt;
  player.update(dt);
  views.update(dt);
  if (player.wading) water.wade(player.pos.x, player.pos.z, Math.hypot(player.vel.x, player.vel.y));
  water.update(dt);
  dayNight.update(dt);
  interact.update(dt);
  sky.update(dt, camera);
  vista.update(dt);
  audio.update(dt, interact.mode === 'soak' || interact.mode === 'tsubo');
  guides.update(player, camera);
  if (dev) dev.update();
  renderer.render(scene, guides.top ? guides.topCam : camera);
  requestAnimationFrame(frame);
}

// 供自動檢查使用
window.__onsen = { toggleDev, get dev() { return dev; }, player, views, scene, camera, renderer, G, dayNight, guides, lights, sky, vista, trees, props, water, interact, audio, ready: false };

startBtn.disabled = true;
startBtn.textContent = '準備中…';
warmUp().catch((e) => console.error(e)).then(() => {
  clock.getDelta();
  frame();
  canvas.classList.add('ready');
  startBtn.disabled = false;
  startBtn.textContent = '進入場景';
  window.__onsen.ready = true;
});
