// 時間切換：場景只有一個數字 night（0 = 白天，0.5 = 黃昏，1 = 夜晚），三個時段都可以停留。
// 切換時讓它在幾秒內平滑地走到下一個時段，天色、陽光、霧、燈光、蒸氣的顏色全部跟著它內插。
// 黃昏是太陽貼在海灣出口的海平線上那一刻：低角度的暖光、燈剛點起來、最亮的幾顆星先出現。
import * as THREE from 'three';
import { G } from './env.js';
import { MATERIALS } from './world.js';

const C = (hex) => new THREE.Color(hex);
const KEY = {
  //            白天            黃昏            夜晚
  skyTop:     [C(0x3f7fca), C(0x2b3f86), C(0x04070f)],
  skyHorizon: [C(0xcfdbe8), C(0xf0a37a), C(0x122039)],
  fog:        [C(0xcfdbe8), C(0xd39c8a), C(0x070b14)],
  sunCol:     [C(0xfff0d0), C(0xff8a48), C(0x8fa6d8)],
  ambient:    [C(0xeef2ff), C(0xb99aa0), C(0x18202e)],
  steam:      [C(0xffffff), C(0xf0c4b4), C(0x2a3442)],
  hemiSky:    [C(0xcfe0f5), C(0xa99ac0), C(0x2c3a5c)],
  hemiGround: [C(0x8a7862), C(0x7a5648), C(0x10131a)],
};
const NUM = {
  sunI:   [2.7, 1.5, 0.10],
  hemiI:  [1.25, 0.62, 0.30],
  expo:   [1.0, 1.0, 1.05],
  fogFar: [3000, 2600, 3500],
};
const SUN_DAY = new THREE.Vector3(-0.5, 0.72, 0.48).normalize();
// 黃昏的太陽：正北偏西一點，剛好落在水道通往外海的缺口上方、貼著海平線；之後沉到海平線下
const SUN_DUSK = new THREE.Vector3(-0.12, 0.04, -0.99).normalize();
const SUN_SET = new THREE.Vector3(-0.14, -0.06, -0.99).normalize();
const SKYLIGHT_NIGHT = new THREE.Vector3(-0.15, 0.85, -0.5).normalize(); // 夜晚的微弱天光，來自銀河方向

const out = new THREE.Color();
function mix3(arr, n, target = out) {
  return n < 0.5 ? target.lerpColors(arr[0], arr[1], n * 2) : target.lerpColors(arr[1], arr[2], n * 2 - 1);
}
const num3 = (a, n) => (n < 0.5 ? a[0] + (a[1] - a[0]) * n * 2 : a[1] + (a[2] - a[1]) * (n * 2 - 1));

const sat = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);
const PHASES = ['day', 'dusk', 'night'];

export function createDayNight({ scene, renderer, sun, hemi, sky, lights }) {
  let phase = 0;              // 0 白天、1 黃昏、2 夜晚
  let from = 0, to = 0, t = 1, dur = 1; // night 從 from 走到 to；t 是 0～1 的進度
  const STEP = 5, FULL = 6;   // 走一個時段、直接從夜晚回白天各花幾秒

  function apply() {
    const n = from + (to - from) * ease(t);
    G.night.value = n;
    G.dusk.value = ease(sat(1 - Math.abs(n - 0.5) / 0.3));
    mix3(KEY.skyTop, n, G.skyTop.value);
    mix3(KEY.skyHorizon, n, G.skyHorizon.value);
    mix3(KEY.fog, n, scene.fog.color);
    scene.fog.far = num3(NUM.fogFar, n);
    mix3(KEY.sunCol, n, G.sunCol.value);
    mix3(KEY.ambient, n, G.ambient.value);
    mix3(KEY.steam, n, G.steamCol.value);
    mix3(KEY.hemiSky, n, hemi.color);
    mix3(KEY.hemiGround, n, hemi.groundColor);
    hemi.intensity = num3(NUM.hemiI, n);

    // 主光：白天是太陽，黃昏時貼在海平線上；過了黃昏繼續下沉並熄掉，再由夜晚的天光接手
    if (n < 0.5) G.sunDir.value.copy(SUN_DAY).lerp(SUN_DUSK, n * 2).normalize();
    else if (n < 0.62) G.sunDir.value.copy(SUN_DUSK).lerp(SUN_SET, (n - 0.5) / 0.12).normalize();
    else G.sunDir.value.copy(SUN_SET).lerp(SKYLIGHT_NIGHT, ease(sat((n - 0.62) / 0.26))).normalize();
    const sunUp = 1 - ease(sat((n - 0.5) / 0.13));   // 太陽還在海平線上的程度
    const skylight = ease(sat((n - 0.78) / 0.22));
    sun.intensity = n < 0.7 ? num3(NUM.sunI, n) * sunUp : NUM.sunI[2] * skylight;
    sun.color.copy(G.sunCol.value);
    sun.position.copy(G.sunDir.value).multiplyScalar(60);

    const day = 1 - Math.min(1, n * 2);
    sky.uniforms.uSunDisc.value = sunUp;
    sky.uniforms.uCloud.value = 1 - n * 0.85;
    G.sunSpec.value = sunUp * (1 - 0.5 * sat(n * 2));
    G.caustic.value = day;
    G.steamDensity.value = 1 + n * 0.25;
    renderer.toneMappingExposure = num3(NUM.expo, n);

    // 燈火隨天色暗下來而亮起：到黃昏時已經全亮
    const lit = sat((n - 0.2) / 0.28);
    MATERIALS.paper.emissiveIntensity = 0.12 + lit * 1.9;
    lights.setLevel(lit);
  }
  apply();

  function go(p, instant) {
    phase = p;
    from = G.night.value; to = p / 2;
    dur = Math.abs(to - from) > 0.75 ? FULL : STEP * Math.max(0.4, Math.abs(to - from) * 2);
    t = instant || from === to ? 1 : 0;
    if (instant) { from = to; apply(); }
  }

  return {
    get phase() { return PHASES[phase]; },
    get isNight() { return phase === 2; },
    // 依序循環：白天 → 黃昏 → 夜晚 → 白天；回傳新的時段
    next() { go((phase + 1) % 3); return PHASES[phase]; },
    // p：'day'／'dusk'／'night'
    set(p, instant = false) { go(Math.max(0, PHASES.indexOf(p)), instant); },
    update(dt) {
      if (t >= 1) return;
      t = Math.min(1, t + dt / dur);
      apply();
    },
  };
}
