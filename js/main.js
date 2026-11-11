import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createWater } from './water.js';
import { createSteam } from './steam.js';
import { createSky } from './sky.js';
import { createLights } from './lights.js';
import { createDayNight } from './daynight.js';
import { createGuides } from './labels.js';
import { Player } from './player.js';
import { G } from './env.js';

const canvas = document.getElementById('scene');
const intro = document.getElementById('intro');
const resume = document.getElementById('resume');
const errBox = document.getElementById('err');
const timeBtn = document.getElementById('time');

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

const camera = new THREE.PerspectiveCamera(68, 1, 0.08, 1500);

const { lamps } = buildWorld(scene);
const water = createWater(scene);
createSteam(scene);
const sky = createSky(scene);
const lights = createLights(scene, lamps);
const dayNight = createDayNight({ scene, renderer, sun, hemi, sky, lights });
const guides = createGuides(scene);
const player = new Player(camera, canvas);

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

function toggleTime() {
  const night = dayNight.toggle();
  timeBtn.textContent = night ? '切換到白天' : '切換到夜晚';
  timeBtn.setAttribute('aria-pressed', night ? 'true' : 'false');
}

document.getElementById('start').addEventListener('click', () => {
  intro.classList.add('hide');
  player.enabled = true;
  timeBtn.hidden = false;
  player.lock();
  canvas.focus();
});
timeBtn.addEventListener('click', () => { toggleTime(); timeBtn.blur(); });

canvas.tabIndex = 0;
canvas.addEventListener('click', () => {
  if (player.enabled && document.pointerLockElement !== canvas) player.lock();
});
document.addEventListener('pointerlockchange', () => {
  resume.hidden = !player.enabled || document.pointerLockElement === canvas;
});

addEventListener('keydown', (e) => {
  if (!player.enabled || e.repeat) return;
  if (e.code === 'KeyT') toggleTime();
  if (e.code === 'KeyM') guides.toggleTop();
  if (e.code === 'KeyL') guides.toggleLabels();
});

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  G.uTime.value += dt;
  player.update(dt);
  if (player.wading) water.wade(player.pos.x, player.pos.z, Math.hypot(player.vel.x, player.vel.y));
  water.update(dt);
  dayNight.update(dt);
  sky.update(dt, camera);
  guides.update(player, camera);
  renderer.render(scene, guides.top ? guides.topCam : camera);
  requestAnimationFrame(frame);
}
frame();

// 供自動檢查使用
window.__onsen = { player, scene, camera, renderer, G, dayNight, guides, lights, sky };
