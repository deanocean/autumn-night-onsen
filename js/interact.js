// 互動：不顯示準星，靠「視線 + 距離」決定目前注視的物件，被注視的物件自身微微發亮，按 E 觸發。
// 注視時畫面下方浮出一行小字提示；H 叫出操作說明。各互動的聲音交給 audio.js。
// 內容：點燈熄燈（全熄後星空變亮）、木桶舀水、坐下觀星、搖落紅葉、湯上牛奶、泡湯；鹿威し自動循環。
import * as THREE from 'three';
import * as L from './layout.js';
import { G } from './env.js';
import { GLSL_NOISE } from './shaders.js';
import { MATERIALS } from './world.js';

const REACH = 2.5;
const UP = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (k) => k * k * (3 - 2 * k);
// 關鍵影格：keys = [[時間, 值], ...]，中間平滑內插
function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t < keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

export function createInteract({ scene, world, camera, player, props, lights, trees, water, sky, guides, audio }) {
  const hintEl = document.getElementById('hint');
  const helpEl = document.getElementById('help');
  scene.updateMatrixWorld(true);

  const targets = [];     // 可注視的物件
  const anims = [];       // 進行中的動畫：(dt) => 是否還要繼續
  const done = new Set(); // 做過的互動種類（目前只是紀錄；提示改成每次都顯示）
  let gaze = null;
  let busy = false;       // 喝牛奶這類不能被打斷的動作
  let mode = null;        // 'soak' 泡湯中、'bench' 坐著觀星
  let look = null;        // 坐下時把視線帶往某個方向
  let flashText = '', flashT = 0;
  const rnd = Math.random;

  // ---------- 被注視時的微亮 ----------
  // 在物件外面疊一層加色的殼（共用原本的幾何），不必動到合併過的共用材質
  function shell(meshes) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, fog: false,
    });
    const list = meshes.map((m) => {
      const o = new THREE.Mesh(m.geometry, mat);
      o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
      o.visible = false; o.renderOrder = 4;
      m.parent.add(o);
      return o;
    });
    return (v) => {
      mat.opacity = v * (0.1 + 0.16 * (1 - G.night.value));
      list.forEach((o) => { o.visible = v > 0.003; });
    };
  }

  // ---------- 水珠（潑水與鹿威し倒水共用） ----------
  const drops = (() => {
    const MAX = 360;
    const pos = new Float32Array(MAX * 3).fill(-999), vel = new Float32Array(MAX * 3), floor = new Float32Array(MAX);
    const live = new Uint8Array(MAX);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d'), gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 0.045, transparent: true, opacity: 0.8, depthWrite: false });
    // 貼近鏡頭的水珠不要放大成一團（往自己身上淋水時水珠就在眼前）
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <logdepthbuf_vertex>', 'gl_PointSize = min(gl_PointSize, scale * 0.075);\n#include <logdepthbuf_vertex>');
    };
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 4; pts.visible = false;
    scene.add(pts);
    let cur = 0, any = false;
    return {
      emit(p, v, fl) {
        const i = cur * 3;
        pos[i] = p.x; pos[i + 1] = p.y; pos[i + 2] = p.z;
        vel[i] = v.x; vel[i + 1] = v.y; vel[i + 2] = v.z;
        floor[cur] = fl; live[cur] = 1; any = true;
        cur = (cur + 1) % MAX;
      },
      update(dt) {
        pts.visible = any;
        if (!any) return;
        any = false;
        for (let k = 0; k < MAX; k++) {
          if (!live[k]) continue;
          const i = k * 3;
          vel[i + 1] -= 9.8 * dt;
          pos[i] += vel[i] * dt; pos[i + 1] += vel[i + 1] * dt; pos[i + 2] += vel[i + 2] * dt;
          if (pos[i + 1] < floor[k]) { live[k] = 0; pos[i + 1] = -999; } else any = true;
        }
        geo.attributes.position.needsUpdate = true;
        mat.color.copy(G.ambient.value).multiplyScalar(0.9).addScalar(0.05);
      },
    };
  })();

  // ---------- 點燈與熄燈 ----------
  lights.switchable.forEach((lamp, i) => {
    const high = lamp.kind === 'hanging' || lamp.kind === 'chochin';
    targets.push({
      id: 'lamp' + i, type: 'lamp',
      pos: lamp.paper.getWorldPosition(V()),
      r: lamp.kind === 'stone' ? 0.36 : 0.28, reach: high ? 3.2 : REACH,
      label: () => (lamp.on ? '熄燈' : '點燈'),
      act() { lamp.on = !lamp.on; audio.lamp(this.pos, lamp.on); },
      glow(v) { lamp.hl = v; },
    });
  });

  // ---------- 木桶舀水 ----------
  {
    const oke = props.oke.group, home = oke.position.clone(), homeQ = oke.quaternion.clone();
    const glow = shell(oke.children.filter((m) => m.isMesh && m !== props.oke.water));
    // 往池心的方向找最近的水面
    const dir = V(L.POOL.cx - home.x, 0, L.POOL.cz - home.z).normalize();
    const dip = home.clone();
    for (let s = 0; s < 4 && L.poolT(dip.x, dip.z) > 0.92; s += 0.05) dip.addScaledVector(dir, 0.05);
    const axis = V(dir.z, 0, -dir.x); // 繞這條軸轉，桶口會倒向池心
    const wy = L.POOL.waterY;
    const q = new THREE.Quaternion(), p = V(), v = V(), fwd = V(), side = V();
    let running = false;
    targets.push({
      id: 'oke', type: 'oke', pos: home.clone().setY(home.y + 0.08), r: 0.3,
      label: () => '舀水',
      enabled: () => !running,
      glow,
      // かけ湯：伸到池邊舀一桶，提到自己肩頭往身上淋，再放回原位
      act() {
        running = true; busy = true; player.frozen = true;
        let t = 0, dipped = false, poured = false, splashed = false, acc = 0;
        const reachS = home.distanceTo(dip);
        const A = dip.clone().setY(wy + 0.02);
        // 舉到眼前偏右上方
        camera.getWorldDirection(fwd).setY(0);
        if (fwd.lengthSq() < 1e-4) fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
        fwd.normalize();
        side.set(-fwd.z, 0, fwd.x);
        camera.updateMatrixWorld();
        const cr = V(), cu = V(), cb = V();
        camera.matrixWorld.extractBasis(cr, cu, cb);
        const H = camera.position.clone().addScaledVector(cb, -0.62).addScaledVector(cu, 0.13).addScaledVector(cr, 0.2);
        const axisP = cr; // 繞這條軸轉，桶口會倒向自己
        const wet = L.inWater(camera.position.x, camera.position.z);
        const feet = wet ? wy : L.groundY(camera.position.x, camera.position.z);
        anims.push((dt) => {
          t += dt;
          if (t < 0.85) {
            const s = track(t, [[0, 0], [0.5, reachS], [0.85, reachS]]);
            const y = track(t, [[0, home.y], [0.25, home.y + 0.3], [0.5, wy + 0.22], [0.72, wy - 0.03], [0.85, wy + 0.02]]);
            oke.position.copy(home).addScaledVector(dir, s).setY(y);
          } else if (t < 2.75) {
            const k = track(t, [[0.85, 0], [1.7, 1]]);
            oke.position.lerpVectors(A, H, k);
            oke.position.y += Math.sin(k * Math.PI) * 0.12;
          } else {
            const k = track(t, [[2.75, 0], [3.7, 1]]);
            oke.position.lerpVectors(H, home, k);
            oke.position.y += Math.sin(k * Math.PI) * 0.15;
          }
          const tiltDip = track(t, [[0, 0], [0.5, 1.0], [0.72, 1.15], [0.95, 0]]);
          const tiltPour = track(t, [[1.6, 0], [2.0, 1.45], [2.5, 1.7], [3.1, 0]]);
          oke.quaternion.copy(homeQ).premultiply(q.setFromAxisAngle(axis, tiltDip)).premultiply(q.setFromAxisAngle(axisP, tiltPour));
          if (!dipped && t > 0.68) {
            dipped = true;
            props.oke.water.visible = true;
            water.addRipple(dip.x, dip.z, 0.9);
            audio.oke('dip', { x: dip.x, y: wy, z: dip.z });
          }
          // 水從桶口成一道水簾淋下來
          if (t > 1.85 && t < 2.5) {
            if (!poured) { poured = true; audio.oke('pour'); }
            acc += dt * 300;
            while (acc >= 1) {
              acc -= 1;
              p.copy(oke.position).addScaledVector(fwd, -0.13).addScaledVector(side, (rnd() - 0.5) * 0.16);
              p.y += 0.02;
              v.copy(fwd).multiplyScalar(-(0.35 + rnd() * 0.7)).addScaledVector(side, (rnd() - 0.5) * 0.5).setY(-0.2 - rnd() * 0.9);
              drops.emit(p, v, feet);
            }
          }
          if (t > 2.4) props.oke.water.visible = false;
          if (!splashed && t > 2.25) {
            splashed = true;
            if (wet) {
              water.addRipple(camera.position.x, camera.position.z, 1.6);
              setTimeout(() => water.addRipple(camera.position.x + side.x * 0.25, camera.position.z + side.z * 0.25, 1.0), 260);
            }
          }
          if (t >= 3.7) {
            oke.position.copy(home); oke.quaternion.copy(homeQ);
            audio.oke('set', home);
            running = false; busy = false; player.frozen = false;
            return false;
          }
          return true;
        });
      },
    });
  }

  // ---------- 坐下觀星 ----------
  {
    const B = L.BENCH, D = L.DECK;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(B.w + 0.006, 0.061, B.d + 0.006));
    seat.position.set(B.x, D.y + B.h, B.z);
    scene.add(seat);
    seat.visible = false; // 只借它的幾何與位置給發亮的殼
    const glow = shell([seat]);
    const hw = B.w / 2 - 0.3;
    let back = null;
    targets.push({
      id: 'bench', type: 'bench',
      pos: (cam) => V(Math.max(B.x - hw, Math.min(B.x + hw, cam.x)), D.y + B.h, B.z),
      r: 0.42,
      label: () => (G.night.value > 0.5 ? '坐下觀星' : '坐下'),
      glow,
      act() {
        mode = 'bench';
        back = { x: player.pos.x, z: player.pos.z, release: true };
        player.anchor = { x: Math.max(B.x - hw, Math.min(B.x + hw, player.pos.x)), z: B.z - 0.04 };
        player.eyeTarget = B.h + 0.76;
        // 面向山谷；夜裡仰頭看銀河
        look = { yaw: 0, pitch: G.night.value > 0.5 ? 0.6 : 0.1, t: 0, dur: 2.6 };
        sky.meteor.rate = 3;
        sky.meteor.wait = Math.min(sky.meteor.wait, 2.5);
        document.body.classList.add('quiet');
        flash('<kbd>E</kbd>起身', 3.5);
      },
      leave() {
        player.anchor = back;
        sky.meteor.rate = 1;
        document.body.classList.remove('quiet');
      },
    });
  }

  // ---------- 搖落紅葉 ----------
  const leaves = (() => {
    const MAX = 140, low = trees.low;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), trees.fallen.material, MAX);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    mesh.frustumCulled = false; mesh.receiveShadow = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) mesh.setMatrixAt(i, zero);
    scene.add(mesh);
    const items = Array.from({ length: MAX }, () => ({ state: 0, age: 0, a: V(), b: V(), p: V(), q: new THREE.Quaternion(), ph: 0, size: 0.1, T: 1, spin: 1, dx: 0, dz: 0, ripple: false }));

    // 葉子可能落在岩石上：落點先往下打一條線找高度
    const rocks = [];
    world.traverse((o) => {
      if (!o.isMesh || (o.material !== MATERIALS.rock && o.material !== MATERIALS.stone)) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      rocks.push({ o, x: s.center.x, z: s.center.z, r: s.radius });
    });
    const ray = new THREE.Raycaster(V(), V(0, -1, 0), 0, 12), nm = new THREE.Matrix3(), n = V();
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), e = new THREE.Euler(), m = new THREE.Matrix4(), sc = V(), col = new THREE.Color();

    function landing(it) {
      const x = it.b.x, z = it.b.z;
      let y = null;
      n.set(0, 1, 0);
      const near = rocks.filter((t) => Math.hypot(t.x - x, t.z - z) < t.r);
      if (near.length) {
        ray.ray.origin.set(x, 6, z);
        const hit = ray.intersectObjects(near.map((t) => t.o), false)[0];
        if (hit) {
          n.copy(hit.face.normal).applyMatrix3(nm.getNormalMatrix(hit.object.matrixWorld)).normalize();
          if (n.y < 0.4) return false; // 太陡，留不住
          y = hit.point.y;
        }
      }
      const wet = L.poolT(x, z) < 1 && (y === null || y < L.POOL.waterY);
      if (wet) { y = L.POOL.waterY; n.set(0, 1, 0); } else if (y === null) y = L.groundY(x, z);
      it.b.y = y + 0.008 + rnd() * 0.006;
      it.wet = wet;
      it.q.setFromUnitVectors(UP, n).multiply(qa.setFromAxisAngle(UP, rnd() * 6.283));
      return true;
    }

    function spawn() {
      let it = items.find((k) => k.state === 0);
      if (!it) it = items.reduce((o, k) => (k.age > o.age ? k : o)); // 沒有空位就回收最舊的一片
      for (let tries = 0; tries < 4; tries++) {
        it.a.set(low.pos.x + (rnd() - 0.5) * 1.5, 1.8 + rnd() * 0.5, low.pos.z + (rnd() - 0.5) * 1.3);
        // 風把葉子往北帶，約一半會落到池面
        it.b.set(it.a.x + (rnd() - 0.5) * 2.4, 0, it.a.z - 0.4 - rnd() * 3.4);
        if (landing(it)) break;
      }
      it.state = 1; it.age = 0; it.ph = rnd() * 6.283; it.spin = (rnd() - 0.5) * 5;
      it.size = 0.085 + rnd() * 0.05;
      it.T = (it.a.y - it.b.y) / (0.6 + rnd() * 0.3);
      it.dx = (rnd() - 0.5) * 0.05; it.dz = (rnd() - 0.5) * 0.05;
      trees.gradColor(low.hue - 0.4 + (rnd() - 0.5) * 2.4, col).multiplyScalar(0.7 + rnd() * 0.35);
      mesh.setColorAt(items.indexOf(it), col);
      mesh.instanceColor.needsUpdate = true;
    }

    let shakeT = -1;
    const queue = [];
    const basePos = low.mesh.position.clone();
    return {
      mesh,
      shake() {
        shakeT = 0;
        for (let i = 0; i < 26; i++) queue.push(0.1 + rnd() * 1.0);
      },
      get shaking() { return shakeT >= 0; },
      update(dt) {
        if (shakeT >= 0) {
          shakeT += dt;
          // 枝條：先猛晃幾下，再慢慢停下來
          const env = Math.min(1, shakeT / 0.12) * Math.pow(Math.max(0, 1 - shakeT / 1.7), 1.5);
          low.uShake.value = env;
          low.mesh.position.set(basePos.x + Math.sin(shakeT * 21) * 0.035 * env, basePos.y + Math.sin(shakeT * 27 + 1) * 0.03 * env, basePos.z + Math.cos(shakeT * 17) * 0.02 * env);
          for (let i = queue.length - 1; i >= 0; i--) if (queue[i] < shakeT) { queue.splice(i, 1); spawn(); }
          if (shakeT > 1.7) { shakeT = -1; low.uShake.value = 0; low.mesh.position.copy(basePos); }
        }
        let dirty = false;
        items.forEach((it, i) => {
          if (it.state === 0) return;
          it.age += dt;
          let s = it.size;
          if (it.state === 1) {
            const u = Math.min(1, it.age / it.T), w = Math.sin(u * Math.PI);
            it.p.lerpVectors(it.a, it.b, u);
            it.p.x += Math.sin(it.age * 2.6 + it.ph) * 0.24 * w;
            it.p.z += Math.cos(it.age * 2.1 + it.ph * 1.3) * 0.2 * w;
            it.p.y += Math.sin(it.age * 5.2 + it.ph) * 0.035 * w;
            // 翻飛，落地前攤平
            qb.setFromEuler(e.set(Math.sin(it.age * 4.1 + it.ph) * 1.1, it.age * it.spin, Math.cos(it.age * 3.3 + it.ph) * 1.1));
            const flat = Math.max(0, (u - 0.85) / 0.15);
            qb.slerp(it.q, flat);
            if (u >= 1) {
              it.state = it.wet ? 3 : 2;
              it.age = 0;
              if (it.wet && (it.ripple = !it.ripple, i % 2 === 0)) water.addRipple(it.b.x, it.b.z, 0.3);
            }
          } else {
            it.p.copy(it.b);
            qb.copy(it.q);
            if (it.state === 3 && it.age < 40) {
              // 浮在水面：慢慢漂、慢慢轉，隨水波輕輕起伏
              const k = Math.exp(-it.age / 14);
              if (L.poolT(it.b.x + it.dx, it.b.z + it.dz) < 0.94) { it.b.x += it.dx * k * dt; it.b.z += it.dz * k * dt; }
              it.q.multiply(qa.setFromAxisAngle(UP, it.spin * 0.03 * k * dt));
              it.p.y += Math.sin(G.uTime.value * 1.3 + it.ph) * 0.003;
            } else if (it.age > 2 && it.age < 120) return; // 靜止的葉子不必每格更新
            if (it.age > 120) { s *= Math.max(0, 1 - (it.age - 120) / 3); if (s === 0) it.state = 0; }
          }
          m.compose(it.p, qb, sc.setScalar(s));
          mesh.setMatrixAt(i, m);
          dirty = true;
        });
        if (dirty) mesh.instanceMatrix.needsUpdate = true;
      },
    };
  })();
  {
    const mat = trees.low.mesh.material;
    targets.push({
      id: 'leaf', type: 'leaf', pos: trees.low.pos.clone(), r: 0.6, reach: 2.8,
      label: () => '搖一搖楓枝',
      enabled: () => !leaves.shaking,
      glow(v) { mat.emissive.setRGB(0.16 * v, 0.085 * v, 0.04 * v); },
      act() { leaves.shake(); audio.leaf(trees.low.pos); },
    });
  }

  // ---------- 湯上牛奶 ----------
  props.milk.bottles.forEach((b, i) => {
    const g = b.group, home = g.position.clone(), homeQ = g.quaternion.clone();
    const glow = shell([b.glass]);
    const right = V(), up = V(), back = V(), hold = V();
    const q = new THREE.Quaternion(), pq = new THREE.Quaternion();
    targets.push({
      id: 'milk' + i, type: 'milk',
      pos: g.getWorldPosition(V()).add(V(0, 0.09, 0)), r: 0.085,
      label: () => '喝一瓶',
      enabled: () => !b.empty,
      glow,
      act() {
        b.empty = true; busy = true; player.frozen = true;
        let t = 0, prev = 0, stage = 0;
        anims.push((dt) => {
          t += dt;
          if (stage === 0 && t > 0.5) { stage = 1; audio.milk('cap'); }
          if (stage === 1 && t > 1.1) { stage = 2; audio.milk('drink'); }
          const inHand = track(t, [[0, 0], [0.6, 1], [2.8, 1], [3.5, 0]]);
          const tilt = track(t, [[0.7, 0], [1.05, 0.75], [2.3, 1.05], [2.75, 0]]);
          // 仰頭喝，喝完視線回到原位
          const off = track(t, [[0.7, 0], [1.05, 0.22], [2.3, 0.3], [2.75, 0]]);
          player.pitch += off - prev; prev = off;
          camera.updateMatrixWorld();
          camera.matrixWorld.extractBasis(right, up, back);
          hold.copy(camera.position).addScaledVector(back, -0.52 + tilt * 0.05).addScaledVector(up, -0.2 + tilt * 0.05).addScaledVector(right, 0.1 * (1 - tilt / 1.2));
          g.parent.worldToLocal(hold);
          g.position.lerpVectors(home, hold, inHand);
          g.parent.getWorldQuaternion(pq).invert();
          q.setFromAxisAngle(right, tilt).multiply(camera.quaternion).premultiply(pq);
          g.quaternion.slerpQuaternions(homeQ, q, inHand);
          if (t > 0.5) b.cap.visible = false;
          b.liquid.scale.y = 1 - track(t, [[1.05, 0], [2.3, 0.97]]);
          if (t > 2.3) b.liquid.visible = false;
          if (t >= 3.5) {
            g.position.copy(home); g.quaternion.copy(homeQ);
            audio.milk('back', this.pos);
            busy = false; player.frozen = false;
            return false;
          }
          return true;
        });
      },
    });
  });

  // ---------- 鹿威し（自動循環，約 12 秒一次） ----------
  const shishi = (() => {
    const S = props.shishi, CYCLE = 12, DOWN = -0.3;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uAmbient: G.ambient },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uAmbient;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){
          float n = vnoise(vec3(vUv.x * 12.0, vUv.y * 5.0 + uTime * 7.0, 2.0));
          gl_FragColor = vec4(uAmbient * (0.7 + 0.45 * n), 0.22 + 0.4 * n);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    // 筧流出的細水柱：頂端固定在出水口，長度隨竹筒的位置改變
    const sg = new THREE.CylinderGeometry(0.0055, 0.0075, 1, 7, 1, true).translate(0, -0.5, 0);
    const stream = new THREE.Mesh(sg, mat);
    stream.position.copy(S.spout);
    stream.renderOrder = 3;
    S.group.add(stream);
    const mouthY = 0.42 + 0.5 * Math.sin(S.rest) + 0.02, rimY = 0.175;
    const floorY = S.group.position.y + 0.15 * S.group.scale.y;
    const mouth = V(), origin = V(), d = V(), v = V();
    let c = 5, acc = 0;
    return {
      get phase() { return c; },
      set phase(x) { c = x; },
      update(dt) {
        const c0 = c;
        c = (c + dt) % CYCLE;
        if (c0 <= 9.75 && c > 9.75) audio.shishi('pour', S.group.position);
        if (c0 <= 11.08 && c > 11.08) audio.shishi('knock', S.group.position);
        let a = S.rest;
        if (c > 9.0 && c <= 9.9) { const k = (c - 9.0) / 0.9; a = S.rest + (DOWN - S.rest) * k * k * k; }      // 注滿、越倒越快
        else if (c > 9.9 && c <= 10.8) a = DOWN + Math.sin((c - 9.9) * 9) * 0.02 * (10.8 - c);                 // 倒水
        else if (c > 10.8 && c <= 11.1) { const k = (c - 10.8) / 0.3; a = DOWN + (S.rest - DOWN) * k * k; }    // 筒尾落下敲石
        else if (c > 11.1 && c <= 11.6) { const k = (c - 11.1) / 0.5; a = S.rest - Math.sin(k * Math.PI) * 0.07 * (1 - k); } // 彈一下
        S.pivot.rotation.z = a;
        const away = Math.min(1, Math.max(0, (S.rest - a) / 0.12));
        stream.scale.y = S.spout.y - (mouthY + (rimY - mouthY) * away);
        if (c > 9.75 && c < 10.75) {
          S.pivot.updateWorldMatrix(true, false);
          mouth.set(0.49, -0.015, 0).applyMatrix4(S.pivot.matrixWorld);
          origin.setFromMatrixPosition(S.pivot.matrixWorld);
          d.subVectors(mouth, origin).normalize();
          const flow = Math.sin(((c - 9.75) / 1.0) * Math.PI);
          acc += dt * 190 * flow;
          while (acc >= 1) {
            acc -= 1;
            v.copy(d).multiplyScalar(0.35 + rnd() * 0.45);
            v.x += (rnd() - 0.5) * 0.12; v.z += (rnd() - 0.5) * 0.12;
            drops.emit(mouth, v, floorY);
          }
        }
      },
    };
  })();

  // ---------- 泡湯 ----------
  const soakDepth = () => L.POOL.waterY - L.groundY(player.pos.x, player.pos.z);
  const canSoak = () => !mode && !busy && !player.anchor && soakDepth() > 0.4;
  function soak() {
    mode = 'soak';
    player.frozen = true;
    // 坐進湯裡，視線降到水面上方
    player.eyeTarget = L.POOL.waterY + 0.34 - L.groundY(player.pos.x, player.pos.z);
    water.addRipple(player.pos.x, player.pos.z, 1.6);
    audio.soak(true);
    flash('<kbd>E</kbd>起身', 3.5);
  }
  function stand() {
    if (mode === 'bench') targets.find((t) => t.id === 'bench').leave();
    if (mode === 'soak') { water.addRipple(player.pos.x, player.pos.z, 1.8); audio.soak(false); }
    player.frozen = false;
    player.eyeTarget = null;
    look = null;
    mode = null;
    done.add('stand');
    flashT = 0;
  }

  // ---------- 提示與說明 ----------
  function flash(text, secs) { flashText = text; flashT = secs; }
  let shown = '';
  function setHint(html) {
    if (html === shown) return;
    shown = html;
    if (html) hintEl.innerHTML = html; // 淡出時保留原本的字
    hintEl.classList.toggle('show', !!html);
  }

  const dir = V(), rel = V();
  function findGaze() {
    if (guides.top || busy || mode || player.anchor || !player.enabled) return null;
    camera.getWorldDirection(dir);
    let best = null, score = 1;
    for (const t of targets) {
      if (t.enabled && !t.enabled()) continue;
      const p = typeof t.pos === 'function' ? t.pos(camera.position) : t.pos;
      rel.subVectors(p, camera.position);
      const along = rel.dot(dir), d2 = rel.lengthSq();
      if (along < 0.1 || d2 > (t.reach || REACH) ** 2) continue;
      const s = Math.sqrt(Math.max(0, d2 - along * along)) / t.r;
      if (s < score) { score = s; best = t; }
    }
    return best;
  }

  function act(t) {
    done.add(t.type);
    t.act();
  }

  return {
    targets, leaves, shishi,
    get gaze() { return gaze; },
    get mode() { return mode; },
    key(code) {
      if (code === 'KeyH') { helpEl.hidden = !helpEl.hidden; return; }
      if (code === 'Escape') { helpEl.hidden = true; return; }
      if (guides.top) return;
      const move = /^(Key[WASD]|Arrow)/.test(code);
      if (mode && (code === 'KeyE' || move)) { if (!busy) stand(); return; }
      if (code !== 'KeyE' || busy) return;
      if (gaze) act(gaze);
      else if (canSoak()) { done.add('soak'); soak(); }
    },
    // 測試用：不靠視線直接觸發（'oke'、'bench'、'leaf'、'milk0'、'lamp3'、'soak'、'stand'）
    trigger(id) {
      if (id === 'stand') return stand();
      if (id === 'soak') return soak();
      act(targets.find((t) => t.id === id));
    },
    update(dt) {
      lights.update(dt);

      gaze = findGaze();
      for (const t of targets) {
        const goal = t === gaze ? 1 : 0;
        if (t.hl === undefined) t.hl = 0;
        if (t.hl !== goal) {
          t.hl = goal > t.hl ? Math.min(1, t.hl + dt * 5) : Math.max(0, t.hl - dt * 3.5);
          t.glow(ease(t.hl));
        }
      }

      if (look) {
        const k = 1 - Math.exp(-dt * 2.2);
        const dy = Math.atan2(Math.sin(look.yaw - player.yaw), Math.cos(look.yaw - player.yaw));
        player.yaw += dy * k;
        player.pitch += (look.pitch - player.pitch) * k;
        if ((look.t += dt) > look.dur) look = null;
      }

      for (let i = anims.length - 1; i >= 0; i--) if (!anims[i](dt)) anims.splice(i, 1);
      leaves.update(dt);
      shishi.update(dt);
      drops.update(dt);

      // 夜裡燈全熄之後，眼睛慢慢適應黑暗：星空與銀河變亮
      const star = 1 + 1.1 * lights.dark * G.night.value;
      G.starBoost.value += (star - G.starBoost.value) * (1 - Math.exp(-dt * 0.45));
      const steam = mode === 'soak' ? 1.7 : 1;
      G.steamBoost.value += (steam - G.steamBoost.value) * (1 - Math.exp(-dt * 1.2));

      flashT = Math.max(0, flashT - dt);
      let hint = '';
      if (flashT > 0) hint = flashText;
      else if (gaze) hint = `<kbd>E</kbd>${gaze.label()}`;
      else if (!gaze && !mode && !busy && canSoak() && !guides.top) hint = '<kbd>E</kbd>泡湯';
      setHint(hint);
    },
  };
}
