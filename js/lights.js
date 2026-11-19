// 燈火：石燈籠、行燈、簷下吊燈籠與窗內透出的光。
// 真正會照亮場景的點光源只放在主要位置（數量越多越吃效能）；
// 另外把所有燈的位置交給水面與蒸氣的 shader，讓它們自己算出被染亮的程度。
import * as THREE from 'three';
import { G, LAMP_N } from './env.js';

// 各類燈的亮度（點光源的強度；簷下吊燈籠與提燈沒有點光源，只影響水面與蒸氣被染亮的程度）。
// sync() 每次都從這裡讀，開發者面板可即時調。
export const POWER = { stone: 5.5, andon: 4.0, ashimoto: 1.5, engawa: 9, hanging: 2.0 };
// GLOW.paper：夜晚和紙發光的強度；GLOW.tint：燈把水面與蒸氣染亮的係數
export const GLOW = { paper: 1.9, tint: 0.11 };

// lanterns：props.js 的石燈籠與行燈；hangingLamps：world.js 的簷下吊燈籠與提燈。
// 每盞燈有自己的和紙材質（mat）與 on 旗標；改 on 之後由 update() 讓該盞的光與紙面一起淡出或亮起
// （k 是目前的亮度比例；要立刻到位就呼叫 snap()）。hl 是被注視時的微亮（interact.js 設定）。
// 可熄的燈（有 paper 的）全部熄掉時，窗內的光（engawa）也跟著暗下來。
export function createLights(scene, lanterns, hangingLamps) {
  const lamps = [];
  // pk：讀 POWER 的哪一格
  const add = (x, y, z, pk, real, kind, src = null) => {
    const lamp = { x, y, z, pk, get power() { return POWER[pk]; }, kind, on: true, k: 1, hl: 0, light: null, mat: src?.mat || null, paper: src?.paper || null, group: src?.group || null };
    if (real) {
      lamp.light = new THREE.PointLight(0xffa860, 0, 15, 1.8);
      lamp.light.position.set(x, y, z);
      scene.add(lamp.light);
    }
    lamps.push(lamp);
  };
  lanterns.forEach((l) => add(l.x, l.y, l.z, l.kind, true, l.kind, l));
  // 簷廊：窗內透出的光，合併成兩盞較亮的光（不是可熄的燈具）
  add(-7.4, 2.0, 9.9, 'engawa', true, 'engawa');
  add(-0.6, 2.0, 9.9, 'engawa', true, 'engawa');
  hangingLamps.forEach((h) => add(h.x, h.y, h.z, 'hanging', false, h.kind, h));

  let level = 0;
  function sync() {
    lamps.forEach((lamp, i) => {
      const v = level * lamp.k;
      if (lamp.light) lamp.light.intensity = lamp.power * v;
      // 白天紙面留一點底亮（像透著天光）；夜裡熄掉的燈要全暗
      if (lamp.mat) lamp.mat.emissiveIntensity = 0.12 * (1 - level * (1 - lamp.k)) + v * GLOW.paper + lamp.hl * (0.3 + 0.6 * v);
      if (i < LAMP_N) G.lampPos.value[i].set(lamp.x, lamp.y, lamp.z, lamp.power * v * GLOW.tint);
    });
  }
  sync();
  const switchable = lamps.filter((l) => l.paper);
  const house = lamps.filter((l) => l.kind === 'engawa');
  return {
    lamps, switchable,
    setLevel(v) { level = v; sync(); },
    sync,
    get level() { return level; },
    get allOff() { return switchable.every((l) => !l.on); },
    // 0 = 至少有一盞亮著，1 = 全場（含窗內）都暗了
    get dark() { return 1 - Math.max(...lamps.map((l) => l.k)); },
    snap() { this.update(100); },
    update(dt) {
      const off = switchable.every((l) => !l.on);
      house.forEach((l) => { l.on = !off; });
      let changed = false;
      for (const l of lamps) {
        const t = l.on ? 1 : 0;
        if (l.k !== t) {
          const step = dt / (l.kind === 'engawa' ? 2.5 : 0.6);
          l.k = t > l.k ? Math.min(t, l.k + step) : Math.max(t, l.k - step);
          changed = true;
        }
        if (l.hl !== l._hl) { l._hl = l.hl; changed = true; }
      }
      G.house.value = house[0].k;
      if (changed) sync();
    },
  };
}
