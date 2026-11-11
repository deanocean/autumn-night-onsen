// 溫泉水面：乳青色的湯。
// 顏色由「水有多深」決定——淺處透明看得到池底石板，深處是不透明的乳青色；
// 反射則是把場景從水面下方再畫一次（平面反射），所以岩石、屋簷、之後的燈籠都會映在水裡。
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { POOL, poolPoint, YUGUCHI } from './layout.js';
import { GLSL_NOISE, GLSL_POOL } from './shaders.js';
import { G } from './env.js';

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
uniform vec4 uLampPos[16]; uniform vec3 uLampCol;
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
  for (int i = 0; i < 16; i++) { vec3 dl = uLampPos[i].xyz - vW; glow += uLampPos[i].w / (1.0 + dot(dl, dl) * 0.22); }
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

  // 水柱：沿拋物線的兩片交叉薄帶
  const tip = new THREE.Vector3(YUGUCHI.x + 0.02, YUGUCHI.y, YUGUCHI.z);
  const pos = [], uv = [], idx = [];
  const SEG = 14, drop = tip.y - POOL.waterY;
  for (const cross of [0, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      const x = tip.x - s * 0.44, y = tip.y - 0.03 - drop * s * s;
      const w = 0.045 + s * 0.05;
      const ox = cross ? 0 : 0, oy = cross ? w : 0, oz = cross ? 0 : w;
      pos.push(x - ox, y - oy, tip.z - oz, x + ox, y + oy, tip.z + oz);
      uv.push(0, s * 3, 1, s * 3);
      if (i < SEG) { const k = base + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  sg.setIndex(idx);
  const stream = new THREE.Mesh(sg, new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uAmbient: G.ambient },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: streamFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  stream.renderOrder = 3;
  scene.add(stream);

  let next = 0, cursor = 0, spoutTimer = 0;
  function addRipple(x, z, strength = 1) {
    rip[cursor].set(x, z, G.uTime.value, strength);
    cursor = (cursor + 1) % MAX_RIPPLES;
  }

  return {
    mesh: water,
    landing,
    addRipple,
    update(dt) {
      // 湯口落水處不斷送出同心漣漪
      spoutTimer -= dt;
      if (spoutTimer <= 0) { addRipple(landing.x, landing.z, 0.9); spoutTimer = 0.55; }
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
