// 開發者面板（` 鍵開關）：即時調整整個專案目前可調的參數，用來檢驗畫面與聲音。
// 只在第一次按 ` 時由 main.js 動態載入，平常完全不影響效能。
// 數值重新整理就還原；「複製變更」把改過的參數（檔案・名稱：原值 → 新值）複製成文字，貼給 Claude 寫回程式。
import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { G } from './env.js';
import { KEY, NUM, STEAM } from './daynight.js';
import { POWER, GLOW } from './lights.js';
import { LOOK } from './world.js';
import { MIX } from './audio.js';
import { MOVE } from './player.js';

const PHASE_NAMES = ['白天', '黃昏', '夜晚'];
const KEY_NAMES = {
  skyTop: '天頂', skyHorizon: '地平線', fog: '霧', sunCol: '陽光', ambient: '水與蒸氣的環境光',
  steam: '蒸氣', hemiSky: '天光（上）', hemiGround: '地面反光（下）',
};
const NUM_NAMES = { sunI: '陽光強度', hemiI: '天光強度', expo: '曝光', fogFar: '霧的最遠距離' };
const NUM_RANGE = { sunI: [0, 5, 0.01], hemiI: [0, 3, 0.01], expo: [0.2, 2.5, 0.01], fogFar: [200, 8000, 10] };

const r3 = (v) => Math.round(v * 1000) / 1000;
const linStr = (c) => `(${r3(c.r)}, ${r3(c.g)}, ${r3(c.b)})`;

export function createDev(ctx) {
  const { renderer, scene, camera, sun, dayNight, lights, sky, vista, trees, water, steam, views, audio } = ctx;
  const refresh = () => dayNight.refresh();

  // ---------- 參數登錄：記原值，供「複製變更」與「全部還原」 ----------
  // 每一筆：name（檔案・名稱）、get()、set(v)、color（是不是 THREE.Color）、after（改完要做的事）
  const params = [];
  function reg(name, get, set, opt = {}) {
    const p = { name, get, set, ...opt };
    const v = get();
    p.orig = v instanceof THREE.Color ? v.clone() : v;
    params.push(p);
    return p;
  }
  const regObj = (file, objName, obj, key, after) => reg(`${file}・${objName}.${key}`, () => obj[key], (v) => { obj[key] = v; }, { after });
  const regColor = (name, color, after, hexInCode = false) => reg(name, () => color, (v) => color.copy(v), { color: true, hexInCode, after });

  // daynight.js 的 KEY／NUM：每一欄各登錄一筆
  for (const k in KEY) KEY[k].forEach((c, i) => regColor(`daynight.js・KEY.${k}[${PHASE_NAMES[i]}]`, c, refresh, true));
  for (const k in NUM) NUM[k].forEach((_, i) => reg(`daynight.js・NUM.${k}[${PHASE_NAMES[i]}]`, () => NUM[k][i], (v) => { NUM[k][i] = v; }, { after: refresh }));

  // ---------- 面板 ----------
  const gui = new GUI({ title: '開發者面板（` 關閉）', width: 330, autoPlace: false });
  gui.domElement.classList.add('dev-panel');
  document.body.appendChild(gui.domElement);
  // 面板裡打字時不要觸發場景的按鍵（main.js、player.js 會略過 .dev-panel 裡的鍵盤事件）
  const tip = (c, t) => { c.domElement.title = t; return c; };
  // THREE.Color 存的是線性值；用十六進位（sRGB）當中介，色票才和畫面上看到的一致
  const addColor = (f, color, name, after) => {
    const proxy = { get c() { return '#' + color.getHexString(); }, set c(v) { color.set(v); if (after) after(); } };
    return f.addColor(proxy, 'c').name(name);
  };

  // 1. 效能
  const stat = { fps: '', ms: '', worst: '', calls: '', tris: '', programs: '', geo: '' };
  {
    const f = gui.addFolder('效能');
    tip(f.add(stat, 'fps').name('FPS').listen().disable(), '最近半秒的平均');
    tip(f.add(stat, 'ms').name('每格毫秒（平均）').listen().disable(), '');
    tip(f.add(stat, 'worst').name('最慢的一格').listen().disable(), '最近半秒裡最慢的一格');
    tip(f.add(stat, 'calls').name('draw calls').listen().disable(), '一格裡所有的繪製次數（含陰影與水面倒影）');
    tip(f.add(stat, 'tris').name('三角形（萬）').listen().disable(), '');
    tip(f.add(stat, 'programs').name('已編譯的 shader').listen().disable(), '平常應為 129；多出來代表有東西在進場後才編譯');
    tip(f.add(stat, 'geo').name('幾何／貼圖').listen().disable(), 'renderer.info.memory');
    f.domElement.querySelectorAll('.controller').forEach((el) => el.classList.add('dev-stat'));
  }

  // 顯示開關：看各組物件吃掉多少效能
  const toggles = [
    ['場外樹林（46 棵）', trees.forest],
    ['崖下與坡上的樹', trees.slope],
    ['遠景地形與海面', [vista.terrain]],
    ['聚落的房子', [vista.houses]],
    ['夜景燈火與倒影', [vista.lights, vista.streaks], true], // auto：可見與否平常由 vista.update 決定
    ['蒸氣', [steam.mesh]],
    ['主池水面（含倒影）', [water.mesh]],
  ].map(([label, objs, auto]) => ({ label, objs, auto, on: true }));
  const sys = { shadows: renderer.shadowMap.enabled, pixelRatio: renderer.getPixelRatio() };
  {
    const f = gui.addFolder('顯示開關');
    toggles.forEach((t) => f.add(t, 'on').name(t.label).onChange((v) => { if (v && !t.auto) t.objs.forEach((o) => { o.visible = true; }); }));
    tip(f.add(sys, 'shadows').name('陰影').onChange((v) => {
      renderer.shadowMap.enabled = v;
      sun.castShadow = v;
    }), '切換時會重新編譯 shader，那一下會頓，屬正常');
    tip(f.add(sys, 'pixelRatio', 0.5, 2, 0.25).name('像素比').onChange((v) => {
      renderer.setPixelRatio(v);
      renderer.setSize(innerWidth, innerHeight, false);
    }), '預設 min(裝置像素比, 2)；調低可看解析度對 FPS 的影響');
    f.close();
  }

  // 2. 時間
  const time = {
    get night() { return G.night.value; },
    set night(v) { dayNight.scrub(v); },
    edit: Math.round(G.night.value * 2),
  };
  const lightCtl = [];
  {
    const f = gui.addFolder('時間');
    tip(f.add(time, 'night', 0, 1, 0.005).name('時刻（0 白天～1 夜晚）').listen(), 'G.night；拖曳時會直接停在那一刻，按 T 恢復正常切換');
    tip(f.add(time, 'edit', { 白天: 0, 黃昏: 1, 夜晚: 2 }).name('編輯的時段').onChange((v) => {
      dayNight.scrub(v / 2);
      lightCtl.forEach((c) => c.updateDisplay());
    }), '選了會跳到該時段；下面「天色與光」改的就是這個時段那一欄');
  }

  // 3. 天色與光：綁在「編輯的時段」那一欄
  {
    const f = gui.addFolder('天色與光（編輯的時段）');
    const proxy = {};
    for (const k in KEY) {
      Object.defineProperty(proxy, k, {
        get: () => '#' + KEY[k][time.edit].getHexString(),
        set: (v) => { KEY[k][time.edit].set(v); refresh(); },
      });
      lightCtl.push(tip(f.addColor(proxy, k).name(KEY_NAMES[k]), `daynight.js・KEY.${k}`));
    }
    for (const k in NUM) {
      Object.defineProperty(proxy, k, {
        get: () => NUM[k][time.edit],
        set: (v) => { NUM[k][time.edit] = v; refresh(); },
      });
      const [a, b, s] = NUM_RANGE[k];
      lightCtl.push(tip(f.add(proxy, k, a, b, s).name(NUM_NAMES[k]), `daynight.js・NUM.${k}`));
    }
  }

  // 4. 天空
  const force = { star: false, starV: 1, cloud: false, cloudV: 0.15 };
  {
    const f = gui.addFolder('天空');
    tip(f.add(force, 'star').name('強制星空亮度'), 'G.starBoost；勾著時熄燈讓星空變亮的效果會被蓋掉');
    f.add(force, 'starV', 0, 4, 0.05).name('　星空亮度倍率');
    tip(f.add(force, 'cloud').name('強制雲量').onChange((v) => { if (!v) refresh(); }), 'sky.js 的 uCloud（平常由時刻決定：白天 1、夜晚 0.15）');
    f.add(force, 'cloudV', 0, 1, 0.01).name('　雲量');
    tip(f.add({ meteor: () => { sky.meteor.wait = 0; } }, 'meteor').name('立刻來一顆流星（只在夜晚）'), '');
    f.close();
  }

  // 5. 燈火
  {
    const f = gui.addFolder('燈火');
    const sync = () => { refresh(); lights.sync(); };
    const PW = { stone: ['石燈籠', 12], andon: ['行燈', 10], ashimoto: ['足元灯', 5], engawa: ['窗內透出的光', 25], hanging: ['吊燈籠與提燈（只染水面蒸氣）', 6] };
    for (const k in PW) tip(f.add(POWER, k, 0, PW[k][1], 0.05).name(PW[k][0]), `lights.js・POWER.${k}`).onChange(sync);
    tip(f.add(GLOW, 'paper', 0, 5, 0.05).name('和紙夜晚發光').onChange(sync), 'lights.js・GLOW.paper（燈籠紙面；窗紙與提燈也跟著它）');
    tip(f.add(GLOW, 'tint', 0, 0.4, 0.005).name('燈染水面與蒸氣').onChange(sync), 'lights.js・GLOW.tint');
    tip(addColor(f, G.lampCol.value, '燈染水面蒸氣的顏色'), 'env.js・G.lampCol');
    tip(f.add(LOOK, 'SHOJI_NIGHT', 0, 2, 0.01).name('窗紙夜晚亮度'), 'world.js・LOOK.SHOJI_NIGHT');
    tip(f.add(LOOK, 'SHOJI_ALBEDO', 0, 1, 0.01).name('窗紙夜晚反光'), 'world.js・LOOK.SHOJI_ALBEDO');
    tip(f.add(LOOK, 'UPPER_GLOW', 0, 2, 0.01).name('二樓與望樓窗'), 'world.js・LOOK.UPPER_GLOW');
    tip(f.add(LOOK, 'EAVE_LAMP', 0, 2, 0.01).name('二樓簷下小提燈'), 'world.js・LOOK.EAVE_LAMP');
    const allOn = (v) => lights.switchable.forEach((l) => { l.on = v; });
    f.add({ on: () => allOn(true) }, 'on').name('全部點亮');
    f.add({ off: () => allOn(false) }, 'off').name('全部熄滅');
    f.close();
  }
  for (const k in POWER) regObj('lights.js', 'POWER', POWER, k);
  for (const k in GLOW) regObj('lights.js', 'GLOW', GLOW, k);
  regColor('env.js・G.lampCol', G.lampCol.value);
  for (const k in LOOK) regObj('world.js', 'LOOK', LOOK, k);

  // 6. 遠景
  {
    const f = gui.addFolder('遠景');
    tip(f.add(vista.uniforms.uAir, 'value', 2000, 60000, 100).name('空氣遠近（越小越朦朧）'), 'vista.js・uAir');
    tip(f.add(vista.lightUniforms.uGain, 'value', 0, 4, 0.05).name('夜景燈火亮度'), 'vista.js・uGain（燈火與海面倒影一起）');
    f.close();
  }
  reg('vista.js・uAir', () => vista.uniforms.uAir.value, (v) => { vista.uniforms.uAir.value = v; });
  reg('vista.js・uGain（夜景燈火亮度）', () => vista.lightUniforms.uGain.value, (v) => { vista.lightUniforms.uGain.value = v; });

  // 7. 水與蒸氣
  const wu = water.mesh.material.uniforms, su = steam.material.uniforms;
  {
    const f = gui.addFolder('水與蒸氣');
    tip(addColor(f, wu.uShallow.value, '主池淺處'), 'water.js・uShallow');
    tip(addColor(f, wu.uDeep.value, '主池深處'), 'water.js・uDeep');
    tip(f.add(STEAM, 'base', 0, 3, 0.01).name('蒸氣濃度（白天）').onChange(refresh), 'daynight.js・STEAM.base');
    tip(f.add(STEAM, 'night', -1, 2, 0.01).name('蒸氣濃度（夜晚多加）').onChange(refresh), 'daynight.js・STEAM.night');
    tip(f.add(su.uWind.value, 'x', -2, 2, 0.01).name('蒸氣風向 x（東西）'), 'steam.js・uWind');
    tip(f.add(su.uWind.value, 'y', -2, 2, 0.01).name('蒸氣風向 z（南北）'), 'steam.js・uWind');
    f.close();
  }
  regColor('water.js・uShallow', wu.uShallow.value);
  regColor('water.js・uDeep', wu.uDeep.value);
  for (const k in STEAM) regObj('daynight.js', 'STEAM', STEAM, k, refresh);
  reg('steam.js・uWind.x', () => su.uWind.value.x, (v) => { su.uWind.value.x = v; });
  reg('steam.js・uWind.y', () => su.uWind.value.y, (v) => { su.uWind.value.y = v; });

  // 8. 相機與移動
  const cam = { fov: camera.fov };
  {
    const f = gui.addFolder('相機與移動');
    tip(f.add(cam, 'fov', 15, 110, 1).name('視角 fov'), 'main.js 的相機（觀景點 V 會用自己的 fov）');
    tip(f.add(MOVE, 'walk', 0.5, 10, 0.1).name('步行速度'), 'player.js・MOVE.walk');
    tip(f.add(MOVE, 'run', 0.5, 20, 0.1).name('快走速度（Shift）'), 'player.js・MOVE.run');
    tip(f.add(MOVE, 'eye', 0.5, 3, 0.01).name('視線高度'), 'player.js・MOVE.eye');
    tip(f.add(MOVE, 'look', 0.0005, 0.006, 0.0001).name('滑鼠靈敏度'), 'player.js・MOVE.look');
    f.close();
  }
  reg('main.js・相機 fov', () => cam.fov, (v) => { cam.fov = v; });
  for (const k in MOVE) regObj('player.js', 'MOVE', MOVE, k);

  // 9. 聲音
  {
    const f = gui.addFolder('聲音（音量）');
    const MIX_NAMES = { master: '總音量', stream: '湯口流水', soak: '泡湯時耳邊的水聲', foot: '足湯竹筒', tsubo: '壺湯湯口', birds: '白天鳥鳴', crickets: '夜晚蟲鳴', wind: '風', steps: '腳步' };
    for (const k in MIX) tip(f.add(MIX, k, 0, 3, 0.01).name(MIX_NAMES[k] || k).onChange(() => audio.applyMix()), `audio.js・MIX.${k}`);
    f.close();
  }
  for (const k in MIX) regObj('audio.js', 'MIX', MIX, k, () => audio.applyMix());

  // 複製變更、全部還原
  const fmt = (p, v) => {
    if (!p.color) return String(typeof v === 'number' ? r3(v) : v);
    return p.hexInCode ? `0x${v.getHexString()}` : `${linStr(v)}（#${v.getHexString()}）`;
  };
  const changed = () => params.filter((p) => {
    const v = p.get(), o = p.orig;
    return p.color ? Math.abs(v.r - o.r) + Math.abs(v.g - o.g) + Math.abs(v.b - o.b) > 1e-6 : Math.abs(v - o) > 1e-9;
  });
  const actions = {
    copy: async () => {
      const list = changed();
      const text = list.length
        ? list.map((p) => `${p.name}：${fmt(p, p.orig)} → ${fmt(p, p.get())}`).join('\n')
        : '（沒有改過的參數）';
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (_) { /* 退回下面的方式 */ }
      console.log('[開發者面板] 變更：\n' + text);
      if (!ok) window.prompt('複製下面的文字：', text);
      copyCtl.name(ok ? `已複製 ${list.length} 項` : '複製變更');
      setTimeout(() => copyCtl.name('複製變更'), 2000);
    },
    reset: () => {
      const afters = new Set();
      params.forEach((p) => { p.set(p.orig); if (p.after) afters.add(p.after); });
      afters.forEach((fn) => fn());
      refresh(); lights.sync(); audio.applyMix();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  };
  const copyCtl = tip(gui.add(actions, 'copy').name('複製變更'), '把改過的參數（檔案・名稱：原值 → 新值）複製到剪貼簿');
  gui.add(actions, 'reset').name('全部還原');

  // ---------- 每格 ----------
  let acc = 0, frames = 0, worst = 0, last = performance.now();
  renderer.info.autoReset = false; // 水面倒影的 render 會中途清掉統計，改成每格自己清
  renderer.info.reset();

  function update() {
    if (open) stats();
    // 以下的覆寫在面板關起來時也持續有效（關面板不等於還原）
    for (const t of toggles) if (!t.on) t.objs.forEach((o) => { o.visible = false; });
    if (force.star) G.starBoost.value = force.starV;
    if (force.cloud) sky.uniforms.uCloud.value = force.cloudV;
    if (!views.active && camera.fov !== cam.fov) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }

  // 效能數字（上一格的完整統計）
  function stats() {
    const now = performance.now(), ms = now - last;
    last = now; acc += ms; frames++; worst = Math.max(worst, ms);
    if (acc >= 500) {
      stat.fps = (1000 * frames / acc).toFixed(1);
      stat.ms = (acc / frames).toFixed(1);
      stat.worst = worst.toFixed(1) + ' ms';
      acc = 0; frames = 0; worst = 0;
      const ri = renderer.info;
      stat.calls = String(ri.render.calls);
      stat.tris = (ri.render.triangles / 1e4).toFixed(1);
      stat.programs = String(ri.programs.length);
      stat.geo = `${ri.memory.geometries}／${ri.memory.textures}`;
    }
    renderer.info.reset();
  }

  let open = true;
  return {
    update,
    get open() { return open; },
    toggle() {
      open = !open;
      gui.show(open); // lil-gui 的 CSS 會蓋過 hidden 屬性，要用它自己的 show／hide
      if (!open) renderer.info.autoReset = true;
      else { renderer.info.autoReset = false; renderer.info.reset(); last = performance.now(); acc = 0; frames = 0; worst = 0; }
      return open;
    },
    gui, params,
  };
}
