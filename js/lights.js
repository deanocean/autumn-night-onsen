// 燈火：石燈籠、行燈、簷下吊燈籠與窗內透出的光。
// 真正會照亮場景的點光源只放在主要位置（數量越多越吃效能）；
// 另外把所有燈的位置交給水面與蒸氣的 shader，讓它們自己算出被染亮的程度。
import * as THREE from 'three';
import { G } from './env.js';

// lanterns：props.js 的石燈籠與行燈；hangingLamps：world.js 的簷下吊燈籠與提燈。
// 每盞燈有自己的和紙材質（mat）與 on 旗標；改 on 之後呼叫 sync()，該盞的光與紙面會一起熄滅或亮起。
export function createLights(scene, lanterns, hangingLamps) {
  const lamps = [];
  const add = (x, y, z, power, real, kind, src = null) => {
    const lamp = { x, y, z, power, kind, on: true, light: null, mat: src?.mat || null, paper: src?.paper || null, group: src?.group || null };
    if (real) {
      lamp.light = new THREE.PointLight(0xffa860, 0, 15, 1.8);
      lamp.light.position.set(x, y, z);
      scene.add(lamp.light);
    }
    lamps.push(lamp);
  };
  lanterns.forEach((l) => add(l.x, l.y, l.z, l.kind === 'stone' ? 5.5 : 4.0, true, l.kind, l));
  // 簷廊：窗內透出的光，合併成兩盞較亮的光（不是可熄的燈具）
  add(-7.4, 2.0, 9.9, 9, true, 'engawa');
  add(-0.6, 2.0, 9.9, 9, true, 'engawa');
  hangingLamps.forEach((h) => add(h.x, h.y, h.z, 2.0, false, h.kind, h));

  let level = 0;
  function sync() {
    lamps.forEach((lamp, i) => {
      const v = lamp.on ? level : 0;
      if (lamp.light) lamp.light.intensity = lamp.power * v;
      // 白天紙面留一點底亮（像透著天光）；夜裡熄掉的燈要全暗
      if (lamp.mat) lamp.mat.emissiveIntensity = lamp.on ? 0.12 + v * 1.9 : 0.12 * (1 - level);
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
