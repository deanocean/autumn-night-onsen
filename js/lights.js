// 燈火：石燈籠、行燈、簷下吊燈籠與窗內透出的光。
// 真正會照亮場景的點光源只放在主要位置（數量越多越吃效能）；
// 另外把所有燈的位置交給水面與蒸氣的 shader，讓它們自己算出被染亮的程度。
import * as THREE from 'three';
import * as L from './layout.js';
import { G } from './env.js';

export function createLights(scene, hangingLamps) {
  const lamps = [];
  const add = (x, y, z, power, real, kind) => {
    const lamp = { x, y, z, power, kind, on: true, light: null };
    if (real) {
      lamp.light = new THREE.PointLight(0xffa860, 0, 15, 1.8);
      lamp.light.position.set(x, y, z);
      scene.add(lamp.light);
    }
    lamps.push(lamp);
  };
  L.LANTERNS.forEach(([x, z, kind]) => {
    const y0 = L.groundY(x, z);
    if (kind === 'stone') add(x, y0 + 0.95, z, 5.5, true, kind);
    else add(x, y0 + 0.4, z, 4.0, true, kind);
  });
  // 簷廊：窗光與吊燈籠合併成兩盞較亮的光
  add(-7.4, 2.0, 9.9, 9, true, 'engawa');
  add(-0.6, 2.0, 9.9, 9, true, 'engawa');
  hangingLamps.forEach((h) => add(h.x, h.y, h.z, 2.0, false, h.kind));

  let level = 0;
  function sync() {
    lamps.forEach((lamp, i) => {
      const v = lamp.on ? level : 0;
      if (lamp.light) lamp.light.intensity = lamp.power * v;
      if (i < 16) G.lampPos.value[i].set(lamp.x, lamp.y, lamp.z, lamp.power * v * 0.11);
    });
  }
  sync();
  return {
    lamps,
    setLevel(v) { level = v; sync(); },
    sync,
  };
}
