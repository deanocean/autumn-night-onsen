// 日夜切換：場景只有一個數字 night（0 = 白天，1 = 夜晚）。
// 切換時讓它在幾秒內平滑地從一端走到另一端，天色、陽光、霧、燈光、蒸氣的顏色全部跟著它內插，
// 中途會經過一段偏暖的黃昏色，所以看起來像太陽落下，而不是直接換一張圖。
import * as THREE from 'three';
import { G } from './env.js';
import { MATERIALS } from './world.js';

const C = (hex) => new THREE.Color(hex);
const KEY = {
  //            白天            黃昏            夜晚
  skyTop:     [C(0x3f7fca), C(0x39508f), C(0x04070f)],
  skyHorizon: [C(0xcfdbe8), C(0xf2a877), C(0x0d1626)],
  fog:        [C(0xcfdbe8), C(0xd9a288), C(0x070b14)],
  sunCol:     [C(0xfff0d0), C(0xff9a55), C(0x8fa6d8)],
  ambient:    [C(0xeef2ff), C(0xc9a79a), C(0x18202e)],
  steam:      [C(0xffffff), C(0xf2cdb8), C(0x2a3442)],
  hemiSky:    [C(0xcfe0f5), C(0xd9b0a0), C(0x2c3a5c)],
  hemiGround: [C(0x8a7862), C(0x7a5a48), C(0x10131a)],
  far0:       [C(0x7f8ca6), C(0x6a5878), C(0x05080f)],
  far1:       [C(0x9eabc2), C(0x94708a), C(0x070b14)],
  far2:       [C(0xbac6d6), C(0xc79a92), C(0x0a0f1a)],
};
const NUM = {
  sunI:   [2.7, 1.4, 0.10],
  hemiI:  [1.25, 0.85, 0.30],
  expo:   [1.0, 1.0, 1.05],
  fogFar: [600, 520, 900],
};
const SUN_DAY = new THREE.Vector3(-0.5, 0.72, 0.48).normalize();
const SUN_DUSK = new THREE.Vector3(-0.86, 0.12, 0.2).normalize();
const SKYLIGHT_NIGHT = new THREE.Vector3(-0.15, 0.85, -0.5).normalize(); // 夜晚的微弱天光，來自銀河方向

const out = new THREE.Color();
function mix3(arr, n, target = out) {
  return n < 0.5 ? target.lerpColors(arr[0], arr[1], n * 2) : target.lerpColors(arr[1], arr[2], n * 2 - 1);
}
const num3 = (a, n) => (n < 0.5 ? a[0] + (a[1] - a[0]) * n * 2 : a[1] + (a[2] - a[1]) * (n * 2 - 1));

export function createDayNight({ scene, renderer, sun, hemi, sky, lights }) {
  let target = 0, raw = 0; // raw 線性前進，套上緩動後才是真正的 night
  const DURATION = 6;

  function apply() {
    const n = raw * raw * (3 - 2 * raw);
    G.night.value = n;
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
    sky.far.forEach((m, i) => mix3(KEY['far' + i], n, m.material.color));

    // 主光：白天是太陽，落到地平線後淡出，再由夜晚的天光接手
    if (n < 0.5) G.sunDir.value.copy(SUN_DAY).lerp(SUN_DUSK, n * 2).normalize();
    else G.sunDir.value.copy(SUN_DUSK).lerp(SKYLIGHT_NIGHT, n * 2 - 1).normalize();
    const dip = 1 - Math.sin(Math.min(1, Math.max(0, (n - 0.35) / 0.4)) * Math.PI) * 0.9;
    sun.intensity = num3(NUM.sunI, n) * dip;
    sun.color.copy(G.sunCol.value);
    sun.position.copy(G.sunDir.value).multiplyScalar(60);

    const day = 1 - Math.min(1, n * 2);
    sky.uniforms.uSunDisc.value = day;
    sky.uniforms.uCloud.value = 1 - n * 0.85;
    G.sunSpec.value = day;
    G.caustic.value = day;
    G.steamDensity.value = 1 + n * 0.25;
    sky.town.material.opacity = Math.max(0, n * 2 - 1);
    renderer.toneMappingExposure = num3(NUM.expo, n);

    // 燈火隨天色暗下來而亮起
    const lit = Math.min(1, Math.max(0, (n - 0.25) / 0.5));
    MATERIALS.paper.emissiveIntensity = 0.12 + lit * 1.9;
    lights.setLevel(lit);
  }
  apply();

  return {
    get isNight() { return target === 1; },
    toggle() { target = target ? 0 : 1; return target; },
    set(night, instant = false) { target = night ? 1 : 0; if (instant) { raw = target; apply(); } },
    update(dt) {
      if (raw === target) return;
      const step = dt / DURATION;
      raw = target > raw ? Math.min(target, raw + step) : Math.max(target, raw - step);
      apply();
    },
  };
}
