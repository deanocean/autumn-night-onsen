// 觀景點（V）：幾個走路到不了的固定鏡頭（屋頂上方、崖外的空中、長焦看望樓……），緩慢運鏡。
// V 依序切到下一個，最後一個之後回到原位；按移動鍵也會直接回到原位。
// 只接管相機，不動玩家：player.update() 之後由 update() 蓋掉相機的位置、方向與視角。
import * as THREE from 'three';
import { t as tr } from './i18n.js'; // 這裡的 t 是運鏡的時間

// name：i18n.js 的 key。a → b：鏡頭在兩點之間來回慢慢移動（一趟 SWEEP 秒）；look：注視的點；fov：垂直視角（預設 68，越小越長焦）
const VIEWS = [
  { name: 'view.bathhouse', a: [7, 6.5, -6], b: [3.5, 7.5, -8.5], look: [-4.5, 4.6, 12], fov: 50 },
  { name: 'view.roofs', a: [-13, 11.5, 21], b: [-9, 12.5, 22], look: [0, 2, -12], fov: 55 },
  { name: 'view.tower', a: [-0.5, 4, -2], b: [-3, 4.5, -2], look: [-4.5, 8.6, 13.5], fov: 20 },
  { name: 'view.cliff', a: [9, 8.5, -17], b: [3, 9.5, -18], look: [-2.5, 1.5, 4], fov: 52 },
  { name: 'view.karahafu', a: [-9, 3.2, 4.6], b: [-7.2, 3.4, 5.4], look: [-4.6, 3.9, 8.6], fov: 30 },
];
const SWEEP = 26, FADE = 0.35, FOV = 68;

export function createViews({ camera, player, guides }) {
  const cap = document.getElementById('viewcap'), fade = document.getElementById('fade');
  const A = new THREE.Vector3(), B = new THREE.Vector3(), LOOK = new THREE.Vector3();
  let idx = -1;      // 現在的觀景點；-1 = 走路
  let next = null;   // 淡出中，等著要切過去的觀景點
  let ft = 0, t = 0, saved = null;

  function apply(i) {
    if (idx < 0 && i >= 0) saved = { yaw: player.yaw, pitch: player.pitch, frozen: player.frozen };
    idx = i; t = 0;
    guides.viewing = i >= 0;
    if (i < 0) {
      if (saved) { player.yaw = saved.yaw; player.pitch = saved.pitch; player.frozen = saved.frozen; }
      saved = null;
      camera.fov = FOV;
      cap.classList.remove('show');
    } else {
      player.frozen = true;
      camera.fov = VIEWS[i].fov;
      cap.innerHTML = `<span>${tr('view.n')} ${i + 1}${tr('view.of')}${VIEWS.length}</span>${tr(VIEWS[i].name)}<span><kbd>V</kbd>${tr('view.next')}　<kbd>W A S D</kbd>${tr('view.back')}</span>`;
      cap.classList.add('show');
    }
    camera.updateProjectionMatrix();
  }
  function go(i) {
    if (next !== null) return;
    next = i; ft = 0;
    fade.classList.add('on');
  }
  return {
    VIEWS,
    get active() { return idx >= 0 || next !== null; },
    next() { go(idx + 1 < VIEWS.length ? idx + 1 : -1); },
    exit() { if (idx >= 0) go(-1); },
    set(i) { next = null; fade.classList.remove('on'); apply(i); }, // 不淡出直接切（截圖用）
    update(dt) {
      if (next !== null && (ft += dt) >= FADE) { apply(next); next = null; fade.classList.remove('on'); }
      if (idx < 0) return;
      const v = VIEWS[idx];
      t += dt;
      const s = 0.5 - 0.5 * Math.cos((t / SWEEP) * Math.PI);
      camera.position.lerpVectors(A.fromArray(v.a), B.fromArray(v.b), s);
      camera.lookAt(LOOK.fromArray(v.look));
    },
  };
}
