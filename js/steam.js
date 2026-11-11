// 蒸氣：許多永遠面向鏡頭的柔軟「煙團」。
// 每一團的位置完全由時間與自己的亂數算出（不需要逐格更新），從水面升起、變大、淡出，再回到水面重來。
import * as THREE from 'three';
import { POOL, poolPoint, poolT, YUGUCHI } from './layout.js';
import { GLSL_NOISE } from './shaders.js';
import { G } from './env.js';

const vert = /* glsl */ `
attribute vec4 aSeed;   // x, z, 相位, 大小
attribute vec3 aKind;   // 上升高度, 速度, 濃度
uniform float uTime;
uniform vec2 uWind;
uniform vec4 uLampPos[16];
varying vec2 vUv; varying float vAlpha; varying float vPhase; varying float vGlow;
void main(){
  float life = fract(uTime * aKind.y + aSeed.z);
  float rise = life * aKind.x;
  vec3 c = vec3(aSeed.x, ${POOL.waterY.toFixed(3)} + 0.1 + rise, aSeed.y);
  // 越高越被風帶走，並左右搖擺
  c.xz += uWind * rise * rise * 0.35;
  c.x += sin(uTime * 0.35 + aSeed.z * 31.0 + rise) * 0.25 * life;
  c.z += cos(uTime * 0.28 + aSeed.z * 17.0 + rise * 0.7) * 0.25 * life;
  float size = aSeed.w * (0.55 + life * 1.5);
  float glow = 0.0;
  for (int i = 0; i < 16; i++) { vec3 dl = uLampPos[i].xyz - c; glow += uLampPos[i].w / (1.0 + dot(dl, dl) * 0.3); }
  vGlow = glow;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  vUv = position.xy * 2.0;
  vPhase = aSeed.z * 53.0;
  float fade = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.45, 1.0, life));
  float near = smoothstep(0.5, 2.6, -mv.z);
  vAlpha = fade * near * aKind.z;
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform vec3 uLampCol; uniform float uDensity;
varying vec2 vUv; varying float vAlpha; varying float vPhase; varying float vGlow;
${GLSL_NOISE}
void main(){
  float d = length(vUv);
  if (d > 1.0) discard;
  float n = fbm(vec3(vUv * 1.4 + vPhase, uTime * 0.12 + vPhase));
  float a = (1.0 - smoothstep(0.15, 1.0, d)) * smoothstep(0.25, 0.75, n);
  gl_FragColor = vec4((uColor + uLampCol * vGlow * 1.6) * (0.85 + 0.3 * n), a * vAlpha * uDensity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSteam(scene) {
  let s = 987654321;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const seeds = [], kinds = [];
  const add = (x, z, size, height, speed, dens) => {
    seeds.push(x, z, rand(), size);
    kinds.push(height, speed, dens);
  };
  // 池面各處升起的蒸氣
  for (let i = 0; i < 150; i++) {
    const [x, z] = poolPoint(rand() * Math.PI * 2, Math.sqrt(rand()) * 0.95);
    add(x, z, 0.8 + rand() * 0.9, 2.2 + rand() * 2.2, 0.05 + rand() * 0.05, 0.3 + rand() * 0.25);
  }
  // 貼著水面漂的薄霧
  for (let i = 0; i < 46; i++) {
    const [x, z] = poolPoint(rand() * Math.PI * 2, Math.sqrt(rand()) * 1.02);
    add(x, z, 1.6 + rand() * 1.4, 0.35 + rand() * 0.35, 0.025 + rand() * 0.02, 0.3 + rand() * 0.2);
  }
  // 湯口附近最濃
  for (let i = 0; i < 34; i++) {
    add(YUGUCHI.x - 0.4 + (rand() - 0.5) * 1.6, YUGUCHI.z + (rand() - 0.5) * 1.8, 0.6 + rand() * 0.7, 2.4 + rand() * 1.6, 0.08 + rand() * 0.06, 0.45 + rand() * 0.3);
  }
  const count = seeds.length / 4;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(kinds), 3));
  geo.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: G.uTime, uColor: G.steamCol, uLampCol: G.lampCol, uLampPos: G.lampPos, uDensity: G.steamDensity,
      uWind: { value: new THREE.Vector2(0.35, -0.2) },
    },
    vertexShader: vert, fragmentShader: frag,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);
  return { mesh, material };
}
