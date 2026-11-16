// 聲音：環境聲（湯口流水、白天鳥鳴、夜晚蟲鳴、風）是 audio/ 裡的實錄循環；
// 互動的短音一部分用錄音（倒水、涉水、木地板腳步、喝），其餘（敲竹、開關燈、搖枝、瓶蓋、石上腳步）即時合成。
// 瀏覽器規定要有使用者操作才能出聲，所以整套在按下「進入場景」時才由 start() 建立；在那之前所有方法都是空動作。
import * as L from './layout.js';
import { G } from './env.js';

const DIR = 'audio/';
const PAD = 0.25; // 循環檔前後各多放的秒數（見 audio/README.md）
// 循環的週期（秒）
const LOOPS = { stream: 45, birds: 52, crickets: 45, wind: 46 };
// 腳步檔：每格幾秒、共幾格
const SLOTS = { step_wood: [0.4, 6], step_wade: [0.7, 12] };
const SHOTS = ['pour', 'splash', 'gulp'];
// 各層的音量，要調整體平衡改這裡
const MIX = {
  master: 0.9,
  stream: 1.5,     // 湯口（有方位，越近越大聲）
  soak: 0.42,      // 泡湯時貼在耳邊的水聲
  birds: 0.6,
  crickets: 0.3,
  wind: 0.26,
  steps: 0.32,
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const rnd = Math.random;

export function createAudio({ camera, player }) {
  let ctx = null, master = null, noise = null;
  let muted = false;
  try { muted = localStorage.getItem('onsen-muted') === '1'; } catch (_) { /* 沒有也無妨 */ }
  const buf = {};  // 解碼好的音檔
  const amb = {};  // 環境聲各層的 GainNode
  let soakK = 0, dist = 0, windT = rnd() * 100;
  const last = { x: 0, z: 0 };

  // ---------- 基礎 ----------
  async function load(name) {
    try {
      const res = await fetch(`${DIR}${name}.m4a`);
      if (!res.ok) throw new Error(res.status);
      buf[name] = await ctx.decodeAudioData(await res.arrayBuffer());
      if (LOOPS[name]) startLoop(name);
    } catch (e) {
      console.warn(`聲音檔 ${name} 載入失敗`, e);
    }
  }

  // 有方位的聲音：接到一個 PannerNode 再進主音量
  function panner(at, ref = 2, rolloff = 1) {
    const p = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: ref, rolloffFactor: rolloff, maxDistance: 200 });
    p.positionX.value = at.x; p.positionY.value = at.y ?? 0.5; p.positionZ.value = at.z;
    p.connect(master);
    return p;
  }
  const out = (o) => (o.at ? panner(o.at, o.ref, o.rolloff) : master);

  function loopSource(name, rate = 1, offset = 0) {
    const s = ctx.createBufferSource();
    s.buffer = buf[name];
    s.loop = true; s.loopStart = PAD; s.loopEnd = PAD + LOOPS[name];
    s.playbackRate.value = rate;
    s.start(0, PAD + offset);
    return s;
  }

  function startLoop(name) {
    const g = ctx.createGain();
    g.gain.value = 0;
    amb[name] = g;
    if (name === 'stream') {
      // 湯口的水聲定位在湯口；另一份放慢、濾掉高頻的當作泡湯時耳邊的水聲
      loopSource(name).connect(g).connect(panner({ x: L.YUGUCHI.x, y: L.POOL.waterY + 0.2, z: L.YUGUCHI.z }, 2.6, 1.15));
      g.gain.value = MIX.stream;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.4;
      const sg = ctx.createGain();
      sg.gain.value = 0;
      amb.soak = sg;
      loopSource(name, 0.72, 19).connect(lp).connect(sg).connect(master);
    } else {
      loopSource(name, 1, rnd() * LOOPS[name]).connect(g).connect(master);
    }
  }

  // 播一段錄音：offset／dur 取其中一段，rate 改變速度與音高
  function play(name, o = {}) {
    if (!ctx || !buf[name]) return;
    const t = ctx.currentTime + (o.delay || 0);
    const s = ctx.createBufferSource();
    s.buffer = buf[name];
    s.playbackRate.value = o.rate || 1;
    const g = ctx.createGain();
    const dur = o.dur ?? buf[name].duration - (o.offset || 0);
    const v = o.gain ?? 1;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    if (o.fade) {
      g.gain.setValueAtTime(v, t + Math.max(0.006, dur / (o.rate || 1) - o.fade));
      g.gain.linearRampToValueAtTime(0, t + dur / (o.rate || 1));
    }
    s.connect(g).connect(out(o));
    s.start(t, o.offset || 0, dur);
  }

  // 一格腳步
  function slot(name, o = {}) {
    const [len, count] = SLOTS[name];
    play(name, { ...o, offset: Math.floor(rnd() * count) * len, dur: len - 0.02 });
  }

  // 合成：一小段經過濾波的雜訊
  function burst(o) {
    const t = ctx.currentTime + (o.delay || 0);
    const s = ctx.createBufferSource();
    s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass'; f.frequency.value = o.freq; f.Q.value = o.q ?? 1;
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f).connect(g).connect(out(o));
    s.start(t, rnd() * 1.5); s.stop(t + o.dur + 0.05);
  }

  // 合成：一個衰減的音
  function tone(o) {
    const t = ctx.currentTime + (o.delay || 0);
    const s = ctx.createOscillator();
    s.type = o.type || 'sine';
    s.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) s.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(g).connect(out(o));
    s.start(t); s.stop(t + o.dur + 0.05);
  }

  // ---------- 腳步 ----------
  function step(run) {
    const { x, z } = player.pos;
    const v = MIX.steps * (run ? 1.15 : 1) * (0.85 + rnd() * 0.3);
    if (player.wading) {
      slot('step_wade', { gain: v * 1.1, rate: 0.92 + rnd() * 0.16 });
    } else if (L.groundY(x, z) > 0.1) {
      // 簷廊、沓脫石旁、望景台：木地板
      slot('step_wood', { gain: v * 0.9, rate: 0.9 + rnd() * 0.2 });
    } else {
      // 石板與土：赤腳，很輕的一聲
      // 以腳掌貼地的沙沙聲為主，低頻的「咚」只留一點，起音放慢才不會硬
      tone({ freq: 170 + rnd() * 30, freqEnd: 120, dur: 0.06, attack: 0.012, gain: v * 0.12 });
      burst({ freq: 1100 + rnd() * 400, q: 0.6, dur: 0.11, attack: 0.014, gain: v * 0.4 });
      burst({ type: 'highpass', freq: 3200 + rnd() * 800, q: 0.5, dur: 0.06, attack: 0.01, gain: v * 0.05 });
    }
  }

  // ---------- 主迴圈 ----------
  function listener() {
    const l = ctx.listener, p = camera.position, e = camera.matrixWorld.elements;
    // 相機朝 -Z：forward = -第三欄，up = 第二欄
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = -e[8]; l.forwardY.value = -e[9]; l.forwardZ.value = -e[10];
      l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6];
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  const api = {
    get started() { return !!ctx; },
    get muted() { return muted; },
    get loaded() { return Object.keys(buf); },
    get debug() { return { ctx, master }; }, // 供自動檢查使用

    // 只能在點擊等使用者操作裡呼叫
    start() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MIX.master;
      // 多個聲音疊在一起時不要爆音
      const limit = new DynamicsCompressorNode(ctx, { threshold: -8, knee: 6, ratio: 8, attack: 0.004, release: 0.25 });
      master.connect(limit).connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
      last.x = player.pos.x; last.z = player.pos.z;
      [...Object.keys(LOOPS), ...Object.keys(SLOTS), ...SHOTS].forEach(load);
      document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume(); });
    },

    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('onsen-muted', muted ? '1' : '0'); } catch (_) { /* 不記也無妨 */ }
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : MIX.master, ctx.currentTime, 0.08);
      return muted;
    },

    // soaking：是否正在泡湯
    update(dt, soaking) {
      if (!ctx) return;
      listener();
      const now = ctx.currentTime, n = G.night.value;
      soakK += ((soaking ? 1 : 0) - soakK) * (1 - Math.exp(-dt * 1.6));
      windT += dt;
      const set = (k, v) => { if (amb[k]) amb[k].gain.setTargetAtTime(v, now, 0.25); };
      // 白天鳥鳴；黃昏（n = 0.5）鳥聲剩三成、蟲鳴剛起約三成；入夜後只剩蟲鳴
      set('birds', MIX.birds * (1 - smooth(0.1, 0.75, n)) * (1 - 0.25 * soakK));
      set('crickets', MIX.crickets * smooth(0.28, 0.9, n));
      set('wind', MIX.wind * (0.75 + 0.25 * Math.sin(windT * 0.11) + 0.12 * Math.sin(windT * 0.37 + 1)));
      set('soak', MIX.soak * soakK);

      // 腳步：照實際走過的距離算，一步一聲
      const dx = player.pos.x - last.x, dz = player.pos.z - last.z;
      last.x = player.pos.x; last.z = player.pos.z;
      const d = Math.hypot(dx, dz), speed = d / Math.max(dt, 1e-4);
      if (speed < 0.35 || speed > 8 || player.anchor) { dist = Math.min(dist, 0.35); return; }
      dist += d;
      const run = speed > 3;
      const stride = player.wading ? 0.62 : run ? 0.92 : 0.7;
      if (dist >= stride) { dist -= stride; step(run); }
    },

    // ---------- 互動 ----------
    lamp(at, on) {
      if (!ctx) return;
      if (on) {
        // 點火：嚓的一聲
        burst({ at, freq: 3200, freqEnd: 1400, q: 0.7, dur: 0.22, attack: 0.015, gain: 0.3 });
        burst({ at, type: 'lowpass', freq: 500, q: 0.5, dur: 0.3, attack: 0.05, gain: 0.25 });
      } else {
        // 吹熄
        burst({ at, type: 'lowpass', freq: 900, freqEnd: 300, q: 0.5, dur: 0.28, attack: 0.03, gain: 0.5 });
      }
    },
    oke(stage, at) {
      if (!ctx) return;
      if (stage === 'dip') play('splash', { at, offset: 0.05, dur: 1.1, fade: 0.5, rate: 1.25, gain: 0.55 });
      if (stage === 'pour') {
        play('pour', { gain: 0.5, rate: 0.95, fade: 0.3 });
        play('splash', { delay: 0.3, offset: 0.9, dur: 1.5, fade: 0.8, gain: 0.35, rate: 1.1 });
      }
      if (stage === 'set') {
        // 木桶放回石上
        tone({ at, freq: 210, freqEnd: 150, dur: 0.12, gain: 0.5 });
        burst({ at, freq: 900, q: 2, dur: 0.05, gain: 0.3 });
      }
    },
    soak(entering) {
      if (!ctx) return;
      play('splash', { rate: entering ? 0.72 : 0.85, gain: 0.55, fade: 0.9 });
      if (!entering) play('pour', { delay: 0.5, offset: 0.9, dur: 1.0, rate: 1.25, gain: 0.22, fade: 0.6 });
    },
    leaf(at) {
      if (!ctx) return;
      // 枝葉沙沙：高頻雜訊，音量跟著枝條的抖動起伏
      const t = ctx.currentTime, N = 120, dur = 1.7;
      const curve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const s = (i / (N - 1)) * dur;
        const env = Math.min(1, s / 0.1) * Math.pow(Math.max(0, 1 - s / dur), 1.5);
        curve[i] = 0.5 * env * (0.45 + 0.55 * Math.abs(Math.sin(s * 10.5)));
      }
      const src = ctx.createBufferSource();
      src.buffer = noise; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
      const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 5200; bp.Q.value = 0.7; bp.gain.value = 6;
      const g = ctx.createGain();
      g.gain.setValueCurveAtTime(curve, t, dur);
      src.connect(hp).connect(bp).connect(g).connect(panner(at, 2.5));
      src.start(t); src.stop(t + dur + 0.05);
    },
    milk(stage, at) {
      if (!ctx) return;
      if (stage === 'cap') {
        // 紙蓋：啵
        tone({ freq: 820, freqEnd: 260, dur: 0.07, gain: 0.35 });
        burst({ freq: 1800, q: 1.2, dur: 0.03, gain: 0.2 });
      }
      if (stage === 'drink') play('gulp', { gain: 0.55 });
      if (stage === 'back') {
        // 玻璃瓶放回木箱
        [2150, 3380, 5240].forEach((f, i) => tone({ at, freq: f, dur: 0.16 - i * 0.03, gain: 0.12 / (i + 1) }));
        tone({ at, freq: 180, freqEnd: 120, dur: 0.08, gain: 0.3 });
      }
    },
    shishi(stage, at) {
      if (!ctx) return;
      if (stage === 'pour') play('pour', { at, ref: 2.5, offset: 0.2, dur: 1.3, rate: 1.45, gain: 0.3, fade: 0.5 });
      if (stage === 'knock') {
        // 竹筒敲石：整個庭園都聽得到的那一聲「叩」
        const o = { at, ref: 5, rolloff: 0.8 };
        burst({ ...o, freq: 950, q: 6, dur: 0.05, gain: 1.2 });
        tone({ ...o, freq: 540, freqEnd: 500, dur: 0.22, gain: 0.6 });
        tone({ ...o, freq: 1270, dur: 0.09, gain: 0.35 });
        tone({ ...o, freq: 262, freqEnd: 240, dur: 0.3, gain: 0.45 });
      }
    },
  };
  return api;
}
