// 天空：白天的藍天、太陽與薄雲；夜晚的星空、銀河與流星。地形與遠山在 vista.js。
// 天空是一顆包住整個場景的大球，顏色全部在 shader 裡依「視線方向」算出來。
// 亮星另外用一顆顆點來畫（才能各自閃爍），銀河則是球面上的一條光帶。
import * as THREE from 'three';
import { GLSL_NOISE } from './shaders.js';
import { G } from './env.js';

// 銀河所在的大圓：法向量 MW_N；最亮的銀心方向 MW_C 放在北方低空，從望景台正好看得到
const MW_N = new THREE.Vector3(1.0, 0.35, 0.0).normalize();
const MW_C = new THREE.Vector3(-0.157, 0.45, -0.88).normalize();
const v3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

const skyFrag = /* glsl */ `
uniform vec3 uTop, uHorizon, uSunDir, uSunCol;
uniform float uNight, uTime, uSunDisc, uStarBoost, uCloud;
varying vec3 vDir;
${GLSL_NOISE}

const vec3 MW_U = ${v3(new THREE.Vector3().crossVectors(MW_N, MW_C).normalize())};
vec3 milkyWay(vec3 d){
  float b = dot(d, ${v3(MW_N)});
  float core = max(dot(d, ${v3(MW_C)}), 0.0);
  float coreG = pow(core, 7.0);
  float sigma = 0.07 + 0.085 * coreG;
  float band = exp(-b * b / (2.0 * sigma * sigma));
  float halo = exp(-b * b / (2.0 * 0.24 * 0.24));
  // 以「沿銀河方向 u、垂直銀河方向 b」當座標取雜訊，雲氣才會順著銀河拉長，而不是一團一團
  float u = atan(dot(d, MW_U), dot(d, ${v3(MW_C)}));
  float t1 = fbm(vec3(u * 4.5, b * 10.0, 1.0)), t2 = fbm(d * 17.0 + 3.0);
  float cloud = (0.3 + 1.0 * t1) * (0.45 + 1.0 * t2);
  // 暗帶：一條沿中線蜿蜒的塵埃，遮住後方星光
  float off = (fbm2(vec3(u * 1.6, 0.0, 3.0)) - 0.37) * 0.11;
  float lw = 0.018 + 0.03 * fbm2(vec3(u * 3.0, 2.0, 7.0));
  float lane = rs(0.3, 0.55, fbm(vec3(u * 4.0, b * 14.0, 9.0))) * exp(-(b - off) * (b - off) / (2.0 * lw * lw));
  float dens = band * (0.55 + 1.0 * coreG) * cloud * (1.0 - lane * 0.85) + halo * 0.035;
  vec3 col = mix(vec3(0.52, 0.62, 0.98), vec3(1.0, 0.84, 0.66), rs(0.0, 0.8, coreG)) * dens * 0.42;
  // 無數分不出個別的小星：在方向空間切格子，每格有機率出現一顆
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 190.0 : 320.0;
    vec3 q = d * sc; vec3 cell = floor(q); vec3 f = fract(q) - 0.5;
    float h = hash1(cell + float(k) * 17.0);
    float prob = 0.035 + band * (0.26 + 0.45 * coreG) * (1.0 - lane * 0.8);
    float star = step(1.0 - prob, h) * rs(0.42, 0.0, length(f + (vec3(hash1(cell + 3.0), hash1(cell + 5.0), hash1(cell + 7.0)) - 0.5) * 0.5));
    float tw = 0.75 + 0.25 * sin(uTime * (1.0 + h * 3.0) + h * 90.0);
    col += star * tw * (0.25 + 0.75 * fract(h * 71.0)) * mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(h * 13.0)) * (k == 0 ? 0.9 : 0.5);
  }
  return col;
}

void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uTop, pow(h, 0.5));
  // 太陽與光暈
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (pow(s, 700.0) * 8.0 + pow(s, 14.0) * 0.25) * uSunDisc;
  // 薄雲
  if (uCloud > 0.0 && d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.22);
    float cl = fbm(vec3(p * 1.1 + uTime * 0.004, 2.0)) * 0.65 + fbm(vec3(p * 3.4 - uTime * 0.006, 7.0)) * 0.35;
    cl = rs(0.5, 0.78, cl) * rs(0.0, 0.25, d.y);
    c = mix(c, mix(uHorizon, vec3(1.0), 0.75) * (0.8 + 0.4 * uSunDisc), cl * 0.55 * uCloud);
  }
  // 夜空
  if (uNight > 0.01) {
    float ext = rs(-0.02, 0.22, d.y); // 接近地平線的星光被大氣削弱
    c += milkyWay(d) * ext * uNight * uNight * uStarBoost;
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const starVert = /* glsl */ `
attribute vec4 aStar; // 顏色 rgb、亮度
attribute float aPhase;
uniform float uTime, uNight, uPx, uStarBoost;
varying vec4 vCol;
void main(){
  vec3 d = normalize(position);
  float ext = smoothstep(-0.01, 0.2, d.y);
  float tw = 0.8 + 0.2 * sin(uTime * (1.5 + aPhase * 4.0) + aPhase * 60.0) * (1.4 - d.y);
  float b = aStar.w * tw * ext * uNight * uNight * (0.7 + 0.3 * uStarBoost);
  vCol = vec4(aStar.rgb, b);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.4 + aStar.w * 2.6) * uPx;
}`;
const starFrag = /* glsl */ `
varying vec4 vCol;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float a = exp(-r * 4.5) * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a * 1.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SKY_K = 16; // 流星的尺度（原本以 700 公尺設計，配合放大的天球）

export function createSky(scene) {
  let seed = 424242;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  // --- 天球 ---
  const uniforms = {
    uTop: G.skyTop, uHorizon: G.skyHorizon, uSunDir: G.sunDir, uSunCol: G.sunCol,
    uNight: G.night, uTime: G.uTime, uStarBoost: G.starBoost,
    uSunDisc: { value: 1 }, uCloud: { value: 1 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(14000, 48, 24), // 比遠景的地形（約 12 公里）還大，星星才會被山擋住
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: skyFrag,
    })
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // --- 亮星：約 2600 顆，三成集中在銀河帶附近 ---
  const N = 2600, pos = [], star = [], phase = [];
  const d = new THREE.Vector3(), t = new THREE.Vector3(), u = new THREE.Vector3().crossVectors(MW_N, MW_C).normalize();
  for (let i = 0; i < N; i++) {
    if (rand() < 0.32) {
      // 銀河帶上：沿大圓取一點，再往法向偏一點
      const a = rand() * Math.PI * 2, off = (rand() + rand() + rand() - 1.5) * 0.14;
      d.copy(MW_C).multiplyScalar(Math.cos(a)).addScaledVector(u, Math.sin(a)).addScaledVector(MW_N, off).normalize();
    } else {
      d.set(rand() * 2 - 1, rand() * 1.15 - 0.15, rand() * 2 - 1);
      if (d.lengthSq() > 1 || d.lengthSq() < 0.01) { i--; continue; }
      d.normalize();
    }
    if (d.y < -0.05) { i--; continue; }
    t.copy(d).multiplyScalar(13500);
    pos.push(t.x, t.y, t.z);
    // 亮度分布：暗星多、亮星少；顏色由偏藍到偏橙
    const mag = Math.pow(rand(), 4.2);
    const temp = rand();
    const col = temp < 0.55 ? [0.78 + temp * 0.3, 0.86 + temp * 0.15, 1.0] : temp < 0.85 ? [1.0, 0.95, 0.86] : [1.0, 0.78, 0.55];
    star.push(col[0], col[1], col[2], 0.16 + mag * 0.84);
    phase.push(rand());
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('aStar', new THREE.Float32BufferAttribute(star, 4));
  sg.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uNight: G.night, uStarBoost: G.starBoost, uPx: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: starVert, fragmentShader: starFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const stars = new THREE.Points(sg, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  scene.add(stars);

  // --- 流星 ---
  const meteorMat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uA; varying vec2 vUv;
      void main(){ float a = pow(vUv.x, 2.5) * (1.0 - abs(vUv.y * 2.0 - 1.0)) * uA; gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * a * 2.5, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const meteor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), meteorMat);
  meteor.visible = false;
  meteor.renderOrder = -8;
  meteor.frustumCulled = false;
  scene.add(meteor);
  const m = { t: 0, dur: 0, wait: 6, from: new THREE.Vector3(), dir: new THREE.Vector3(), rate: 1 };

  // 遠山與夜景燈火在 vista.js

  const tmp = new THREE.Vector3();
  return {
    dome, stars, uniforms, meteor: m,
    update(dt, camera) {
      dome.position.copy(camera.position);
      stars.position.copy(camera.position);
      // 流星：夜晚每隔一陣子劃過北方天空
      if (G.night.value > 0.9) {
        if (meteor.visible) {
          m.t += dt;
          const k = m.t / m.dur;
          if (k >= 1) { meteor.visible = false; m.wait = (5 + rand() * 14) / m.rate; }
          else {
            const len = (55 + 40 * Math.sin(k * Math.PI)) * SKY_K;
            tmp.copy(m.from).addScaledVector(m.dir, k * 260 * SKY_K);
            meteor.position.copy(camera.position).add(tmp);
            meteor.scale.set(len, 1.3 * SKY_K, 1);
            meteor.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), m.dir);
            meteorMat.uniforms.uA.value = Math.sin(k * Math.PI) * G.night.value;
          }
        } else if ((m.wait -= dt) <= 0) {
          const az = -Math.PI / 2 + (rand() - 0.5) * 2.2, el = 0.5 + rand() * 0.6;
          m.from.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(700 * SKY_K);
          m.dir.set(rand() - 0.5, -0.35 - rand() * 0.4, rand() - 0.5).normalize();
          // 讓軌跡大致垂直於視線，才看得到一道長線
          tmp.copy(m.from).normalize();
          m.dir.addScaledVector(tmp, -m.dir.dot(tmp)).normalize();
          m.t = 0; m.dur = 0.55 + rand() * 0.5;
          meteor.visible = true;
        }
      } else meteor.visible = false;
    },
  };
}
