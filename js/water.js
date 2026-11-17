// 溫泉水面：乳青色的湯。
// 顏色由「水有多深」決定——淺處透明看得到池底石板，深處是不透明的乳青色；
// 反射則是把場景從水面下方再畫一次（平面反射），所以岩石、屋簷、之後的燈籠都會映在水裡。
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { POOL, poolPoint, YUGUCHI, ASHIYU, DECK, TSUBO, potProfile } from './layout.js';
import { GLSL_NOISE, GLSL_POOL } from './shaders.js';
import { G, LAMP_N } from './env.js';

const MAX_RIPPLES = 14;

const vertexShader = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vRefl;
varying vec3 vW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vRefl = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 color;
uniform float uTime;
uniform vec3 uSunDir, uSunCol, uAmbient, uShallow, uDeep;
uniform vec4 uRip[${MAX_RIPPLES}];
uniform vec3 uSplash; uniform float uSunSpec;
uniform vec4 uLampPos[${LAMP_N}]; uniform vec3 uLampCol;
varying vec4 vRefl;
varying vec3 vW;
${GLSL_NOISE}
${GLSL_POOL}

float waveH(vec2 p){
  float t = uTime;
  float h = 0.55 * vnoise(vec3(p * 1.1 + t * vec2(0.10, 0.06), t * 0.15));
  h += 0.28 * vnoise(vec3(p * 2.9 - t * vec2(0.09, 0.14), t * 0.2));
  h += 0.12 * vnoise(vec3(p * 7.5 + t * vec2(0.22, -0.18), t * 0.3));
  h *= 0.035;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRip[i];
    float age = t - r.z;
    if (age > 0.0 && age < 7.0) {
      float d = distance(p, r.xy);
      float front = age * 0.85;
      float env = exp(-pow((d - front) * 1.5, 2.0)) * exp(-age * 0.55) / (1.0 + d * 0.6);
      h += sin((d - front) * 11.0) * env * r.w * 0.03;
    }
  }
  return h;
}

void main(){
  vec2 p = vW.xz;
  float e = 0.05;
  float h0 = waveH(p), hx = waveH(p + vec2(e, 0.0)), hz = waveH(p + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));

  vec3 V = normalize(cameraPosition - vW);
  float ndv = max(dot(n, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 4.0);

  vec2 ruv = vRefl.xy / vRefl.w + n.xz * 0.06;
  vec3 refl = texture2D(tDiffuse, ruv).rgb;

  // 水體顏色：視線穿過的水越多，越接近不透明的乳青
  float depth = poolDepth(p);
  float path = depth / max(V.y, 0.22);
  float turb = 1.0 - exp(-path * 7.5);
  vec3 body = mix(uShallow, uDeep, turb) * uAmbient;
  body += uSunCol * uDeep * 0.22 * max(uSunDir.y, 0.0) * turb;
  // 燈籠把附近的湯染成暖色
  float glow = 0.0;
  for (int i = 0; i < ${LAMP_N}; i++) { vec3 dl = uLampPos[i].xyz - vW; glow += uLampPos[i].w / (1.0 + dot(dl, dl) * 0.22); }
  body += uLampCol * (uDeep * 1.6 + 0.12) * glow * (0.25 + 0.75 * turb);
  float alpha = mix(0.10, 0.99, turb);

  // 岸邊與湯口的白沫
  float foam = rs(0.035, 0.0, depth + (vnoise(vec3(p * 9.0, uTime * 0.6)) - 0.5) * 0.03) * 0.5;
  float ds = distance(p, uSplash.xy);
  foam += rs(0.75, 0.0, ds) * (0.45 + 0.55 * vnoise(vec3(p * 14.0, uTime * 3.0))) * uSplash.z;
  foam = clamp(foam, 0.0, 1.0);
  body = mix(body, uAmbient * 0.95 + uLampCol * glow * 0.6, foam * 0.8);
  alpha = max(alpha, foam * 0.85);

  vec3 col = mix(body, refl, fres * (1.0 - foam * 0.7));
  vec3 Hv = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(n, Hv), 0.0), 380.0) * 5.0 * uSunSpec;
  alpha = mix(alpha, 1.0, fres);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 湯口流下的水柱
const streamFrag = /* glsl */ `
uniform float uTime; uniform vec3 uAmbient;
varying vec2 vUv;
${GLSL_NOISE}
void main(){
  float n = vnoise(vec3(vUv.x * 7.0, vUv.y * 5.0 - uTime * 5.0, 1.0));
  float n2 = vnoise(vec3(vUv.x * 18.0, vUv.y * 9.0 - uTime * 8.0, 4.0));
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = smoothstep(0.0, 0.5, edge) * (0.5 + 0.5 * n) * (0.55 + 0.45 * n2);
  vec3 c = uAmbient * (0.8 + 0.4 * n2);
  gl_FragColor = vec4(c, a * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 小水面（足湯、壺湯）：不做平面反射（每多一面就要把整個場景再畫一次），只映天空的顏色。
// 水很淺，半透明看得到槽底的木板。
const stillFrag = /* glsl */ `
uniform float uTime, uSunSpec, uNight, uAlpha, uGlow;
uniform vec3 uSunDir, uSunCol, uAmbient, uBody, uSkyTop, uSkyHorizon, uLampCol;
uniform vec4 uRip[4];
uniform vec4 uLampPos[${LAMP_N}];
varying vec3 vW;
${GLSL_NOISE}
float waveH(vec2 p){
  float t = uTime;
  float h = 0.6 * vnoise(vec3(p * 3.2 + t * vec2(-0.16, 0.05), t * 0.2));
  h += 0.4 * vnoise(vec3(p * 8.5 + t * vec2(-0.28, -0.12), t * 0.3));
  h *= 0.012;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRip[i];
    float age = t - r.z;
    if (age > 0.0 && age < 5.0) {
      float d = distance(p, r.xy);
      float front = age * 0.5;
      float env = exp(-pow((d - front) * 3.5, 2.0)) * exp(-age * 0.8) / (1.0 + d * 1.5);
      h += sin((d - front) * 24.0) * env * r.w * 0.012;
    }
  }
  return h;
}
void main(){
  vec2 p = vW.xz;
  float e = 0.025;
  float h0 = waveH(p), hx = waveH(p + vec2(e, 0.0)), hz = waveH(p + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.5));
  float glow = 0.0;
  for (int i = 0; i < ${LAMP_N}; i++) { vec3 dl = uLampPos[i].xyz - vW; glow += uLampPos[i].w / (1.0 + dot(dl, dl) * 0.22); }
  vec3 body = uBody * uAmbient * mix(1.0, 0.32, uNight) + uLampCol * (uBody + 0.1) * glow * uGlow;
  vec3 col = mix(body, sky, fres);
  vec3 Hv = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(n, Hv), 0.0), 380.0) * 5.0 * uSunSpec;
  gl_FragColor = vec4(col, mix(uAlpha, 1.0, fres));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 壺湯滿出來的水：貼在壺身外側的一層水膜，一道道往下流。uFlow 是水量（平常細細地流，人坐進去時湧出一陣）
const overflowFrag = /* glsl */ `
uniform float uTime, uFlow; uniform vec3 uAmbient;
varying vec2 vUv;
${GLSL_NOISE}
void main(){
  float ang = vUv.x * 6.2832;
  vec2 dir = vec2(cos(ang), sin(ang));
  float sector = vnoise(vec3(dir * 1.7, uTime * 0.06));           // 哪幾面流得多，慢慢換位置
  float cover = clamp(sector * 0.85 + uFlow * 0.6 - 0.3, 0.0, 1.0);
  float n = vnoise(vec3(dir * 16.0, vUv.y * 1.6 + uTime * 1.4));
  float n2 = vnoise(vec3(dir * 40.0, vUv.y * 5.0 + uTime * 2.5));
  float sheet = smoothstep(1.0 - cover, 1.3 - cover, n + 0.25 * n2);
  float a = sheet * (0.4 + 0.6 * n2) * min(0.6, 0.1 + 0.22 * uFlow);
  gl_FragColor = vec4(uAmbient * (0.7 + 0.55 * n2), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 沿拋物線落下的水柱：兩片交叉的薄帶。tip 出水口、dx 落水時的水平位移、bottom 水面高度
function streamGeometry(tip, dx, bottom, w0, w1, SEG = 14) {
  const pos = [], uv = [], idx = [];
  const drop = tip.y - bottom;
  for (const cross of [0, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      const x = tip.x + s * dx, y = tip.y - drop * s * s;
      const w = w0 + s * (w1 - w0);
      const oy = cross ? w : 0, oz = cross ? 0 : w;
      pos.push(x, y - oy, tip.z - oz, x, y + oy, tip.z + oz);
      uv.push(0, s * 3, 1, s * 3);
      if (i < SEG) { const k = base + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function createWater(scene) {
  const N = 128;
  const shape = new THREE.Shape();
  for (let i = 0; i < N; i++) {
    const [x, z] = poolPoint((i / N) * Math.PI * 2, 1.004);
    if (i) shape.lineTo(x, -z); else shape.moveTo(x, -z);
  }
  const rip = [];
  for (let i = 0; i < MAX_RIPPLES; i++) rip.push(new THREE.Vector4(0, 0, -100, 0));

  const landing = { x: YUGUCHI.x - 0.42, z: YUGUCHI.z };
  const shader = {
    name: 'OnsenWater',
    uniforms: {
      color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
      uTime: { value: 0 }, uSunDir: { value: null }, uSunCol: { value: null }, uAmbient: { value: null },
      uShallow: { value: new THREE.Color(0.50, 0.80, 0.78) },
      uDeep: { value: new THREE.Color(0.10, 0.47, 0.55) },
      uRip: { value: rip },
      uSplash: { value: new THREE.Vector3(landing.x, landing.z, 1) },
      uLampPos: { value: null }, uLampCol: { value: null }, uSunSpec: { value: 1 },
    },
    vertexShader, fragmentShader,
  };
  const dpr = Math.min(devicePixelRatio, 2);
  const water = new Reflector(new THREE.ShapeGeometry(shape), {
    shader, clipBias: 0.003,
    textureWidth: Math.floor(innerWidth * dpr * 0.5), textureHeight: Math.floor(innerHeight * dpr * 0.5),
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = POOL.waterY;
  const u = water.material.uniforms;
  // 與全場共用同一份太陽與環境光
  u.uTime = G.uTime; u.uSunDir = G.sunDir; u.uSunCol = G.sunCol; u.uAmbient = G.ambient;
  u.uRip.value = rip;
  u.uLampPos = G.lampPos; u.uLampCol = G.lampCol;
  u.uSunSpec = G.sunSpec;
  water.material.transparent = true;
  water.material.depthWrite = false;
  water.renderOrder = 2;
  scene.add(water);

  // 湯口的水柱
  const tip = new THREE.Vector3(YUGUCHI.x + 0.02, YUGUCHI.y - 0.03, YUGUCHI.z);
  const sg = streamGeometry(tip, -0.44, POOL.waterY - 0.03, 0.045, 0.095);
  const stream = new THREE.Mesh(sg, new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uAmbient: G.ambient },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: streamFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  stream.renderOrder = 3;
  scene.add(stream);

  // ---------- 足湯 ----------
  const A = ASHIYU, footY = DECK.y + A.waterY;
  const footRip = Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -100, 0));
  // 小水面：body 水色、alpha 正面看下去的不透明度（越淺的水越透）、ripples 這一面自己的漣漪、glow 被燈火染亮的程度
  const still = (geo, body, alpha, ripples, x, y, z, glow = 1) => {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: {
        uTime: G.uTime, uSunDir: G.sunDir, uSunCol: G.sunCol, uAmbient: G.ambient, uSunSpec: G.sunSpec,
        uSkyTop: G.skyTop, uSkyHorizon: G.skyHorizon, uLampPos: G.lampPos, uLampCol: G.lampCol,
        uBody: { value: new THREE.Color(...body) }, uAlpha: { value: alpha }, uGlow: { value: glow }, uNight: G.night, uRip: { value: ripples },
      },
      vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: stillFrag, transparent: true, depthWrite: false,
    }));
    m.position.set(x, y, z);
    m.renderOrder = 2;
    scene.add(m);
    return m;
  };
  const ripples4 = () => {
    const list = Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, -100, 0));
    let cur = 0;
    return { list, add(x, z, strength = 1) { list[cur].set(x, z, G.uTime.value, strength); cur = (cur + 1) % 4; } };
  };
  const footMesh = still(new THREE.PlaneGeometry(A.x1 - A.x0, A.seatZ0 - A.tubZ0).rotateX(-Math.PI / 2), [0.15, 0.56, 0.58], 0.62, footRip, (A.x0 + A.x1) / 2, footY, (A.tubZ0 + A.seatZ0) / 2);
  const footStream = new THREE.Mesh(streamGeometry(new THREE.Vector3(A.spout.x, A.spout.y, A.spout.z), -0.07, footY, 0.012, 0.02, 10), stream.material);
  footStream.renderOrder = 3;
  scene.add(footStream);
  const footLanding = { x: A.spout.x - 0.07, z: A.spout.z };
  let footCur = 0, footTimer = 0;
  const foot = {
    mesh: footMesh, y: footY, landing: footLanding,
    addRipple(x, z, strength = 1) {
      footRip[footCur].set(x, z, G.uTime.value, strength);
      footCur = (footCur + 1) % 4;
    },
  };

  // ---------- 壺湯 ----------
  // 壺裡的湯、淺池的水面、湯口的水柱、沿壺身流下的溢流
  const T = TSUBO, P = T.pot;
  const potRip = ripples4(), pondRip = ripples4();
  still(new THREE.CircleGeometry(P.inner + 0.012, 56).rotateX(-Math.PI / 2), [0.17, 0.55, 0.54], 0.84, potRip.list, T.x, P.waterY, T.z, 0.25);
  still(new THREE.RingGeometry(0.605, T.r, 72, 1).rotateX(-Math.PI / 2), [0.07, 0.2, 0.2], 0.16, pondRip.list, T.x, T.waterY, T.z, 0.22);
  const potLanding = { x: T.spout.tip.x - 0.13, z: T.z };
  const potStream = new THREE.Mesh(streamGeometry(new THREE.Vector3(T.spout.tip.x, T.spout.tip.y, T.spout.tip.z), -0.13, P.waterY, 0.022, 0.04, 10), stream.material);
  potStream.renderOrder = 3;
  scene.add(potStream);
  const og = new THREE.LatheGeometry(potProfile(0.004).map(([r, y]) => new THREE.Vector2(r, y)), 64);
  { const uv = og.attributes.uv, p = og.attributes.position; for (let i = 0; i < uv.count; i++) uv.setY(i, p.getY(i) / P.h); }
  const uFlow = { value: 0.4 };
  const overflow = new THREE.Mesh(og, new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uAmbient: G.ambient, uFlow },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: overflowFrag, transparent: true, depthWrite: false,
  }));
  overflow.position.set(T.x, T.floorY, T.z);
  overflow.renderOrder = 3;
  scene.add(overflow);
  let potTimer = 0, pondTimer = 0, surge = 0;
  const tsubo = {
    pot: potRip, pond: pondRip, landing: potLanding,
    // 人坐進壺裡（或起身）：水湧出壺緣，流下來在淺池激起幾圈漣漪
    surge(k = 1) { surge = Math.max(surge, k); pondTimer = Math.min(pondTimer, 0.25); },
  };

  let next = 0, cursor = 0, spoutTimer = 0;
  function addRipple(x, z, strength = 1) {
    rip[cursor].set(x, z, G.uTime.value, strength);
    cursor = (cursor + 1) % MAX_RIPPLES;
  }

  return {
    mesh: water,
    landing,
    addRipple,
    foot,
    tsubo,
    update(dt) {
      surge *= Math.exp(-dt / 2.2);
      uFlow.value = 0.4 + 1.2 * surge;
      potTimer -= dt;
      if (potTimer <= 0) { potRip.add(potLanding.x, potLanding.z, 0.9); potTimer = 0.9; }
      pondTimer -= dt;
      if (pondTimer <= 0) {
        const a = Math.random() * Math.PI * 2;
        pondRip.add(T.x + Math.cos(a) * 0.68, T.z + Math.sin(a) * 0.68, 0.7 + 1.5 * surge);
        pondTimer = surge > 0.15 ? 0.35 : 1.1;
      }
      // 湯口落水處不斷送出同心漣漪
      spoutTimer -= dt;
      if (spoutTimer <= 0) { addRipple(landing.x, landing.z, 0.9); spoutTimer = 0.55; }
      footTimer -= dt;
      if (footTimer <= 0) { foot.addRipple(footLanding.x, footLanding.z, 0.7); footTimer = 1.3; }
      next = Math.max(0, next - dt);
    },
    // 人在水中移動時留下的漣漪；回傳是否真的產生了一圈
    wade(x, z, speed) {
      if (next > 0 || speed < 0.25) return false;
      addRipple(x, z, 0.5 + speed * 0.45);
      next = 0.42;
      return true;
    },
    resize(w, h) {
      const d = Math.min(devicePixelRatio, 2) * 0.5;
      water.getRenderTarget().setSize(Math.floor(w * d), Math.floor(h * d));
    },
  };
}
