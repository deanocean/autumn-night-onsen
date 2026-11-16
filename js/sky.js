// 天空：白天的藍天、太陽與薄雲；夜晚的星空、銀河與流星。地形與遠山在 vista.js。
// 天空是一顆包住整個場景的大球，顏色全部在 shader 裡依「視線方向」算出來。
// 亮星另外用一顆顆點來畫（才能各自閃爍），銀河則是球面上的一條光帶（雲氣、塵埃暗帶、星雲與無數小星）。
import * as THREE from 'three';
import { GLSL_NOISE } from './shaders.js';
import { G } from './env.js';

// 銀河所在的大圓：法向量 MW_N；最亮的銀心方向 MW_C 放在北方低空，從望景台正好看得到
const MW_N = new THREE.Vector3(1.0, 0.35, 0.0).normalize();
const MW_C = new THREE.Vector3(-0.157, 0.45, -0.88).normalize();
const v3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

const MW_U = new THREE.Vector3().crossVectors(MW_N, MW_C).normalize();
const MW_B = 0.5; // 貼圖涵蓋的範圍：離銀河中線 ±0.5（緯度的正弦）

// 銀河的雲氣、塵埃與星雲不會動，啟動時畫成一張貼圖（rgb 是開根號後的亮度、a 是塵埃的濃度），
// 天空的 shader 每個像素只取樣一次。直接在天空的 shader 裡算的話，十幾層雜訊會讓夜晚的畫格掉一半。
const bakeFrag = /* glsl */ `
varying vec2 vUv;
${GLSL_NOISE}
void main(){
  // 銀河座標：b 是離銀河中線的距離（緯度）、u 是沿銀河的經度（0 在銀心；接縫在地平線下）
  float u = (vUv.x * 2.0 - 1.0) * 3.14159265, b = (vUv.y * 2.0 - 1.0) * ${MW_B.toFixed(2)};
  float cu = cos(u) * sqrt(1.0 - b * b);
  vec3 d = ${v3(MW_C)} * cu + ${v3(MW_U)} * sin(u) * sqrt(1.0 - b * b) + ${v3(MW_N)} * b;
  float coreG = pow(max(cu, 0.0), 7.0);
  float bulge = exp(-(u * u / 0.09 + b * b / 0.022));
  float sigma = 0.072 + 0.085 * coreG + 0.05 * (fbm2(vec3(u * 1.7, 1.0, 5.0)) - 0.37);
  // 剖面是窄的一層疊寬的一層：中間亮，往外拖得很長，才不會像一條有邊界的帶子貼在天上
  float wide = exp(-b * b / (2.0 * sigma * sigma * 6.5));
  float band = 0.62 * exp(-b * b / (2.0 * sigma * sigma)) + 0.38 * wide;
  float halo = exp(-b * b / (2.0 * 0.25 * 0.25));
  vec3 col; float dust;
  // 塵埃與雲氣共用一組被扭過的座標：雲才會捲、會分岔，而不是順著銀河拉成直線
  vec3 p = vec3(u * 5.0, b * 7.5, 0.0);
  vec2 w = vec2(fbm(p + vec3(0.0, 0.0, 3.1)), fbm(p + vec3(5.2, 1.3, 7.7))) - 0.47;
  vec3 pw = p + vec3(w * 1.9, 0.0);
  // 暗帶：沿中線蜿蜒的不規則塵埃雲，往銀心越厚；偶爾有幾縷伸到帶外
  float n1 = fbm(pw + 11.0), n2 = fbm(pw * 3.3 + 23.0);
  float mid = (fbm2(vec3(u * 1.4, 0.0, 3.0)) - 0.37) * 0.13 + 0.012;
  float bw = 0.014 + 0.022 * coreG + 0.03 * fbm2(vec3(u * 2.6, 2.0, 7.0));
  float lane = exp(-(b - mid) * (b - mid) / (2.0 * bw * bw)) * (0.5 + 0.5 * rs(0.25, 0.6, fbm2(vec3(u * 3.4, 6.0, 2.0))));
  float dn = n1 * 0.68 + n2 * 0.32;
  dust = rs(0.47, 0.70, dn + lane * 0.30 - 0.09) * rs(0.55, 0.12, abs(b)) * (0.55 + 0.45 * rs(-0.6, 0.6, cu));
  // 細的塵埃絲：從暗帶分出去的一條條細紋
  float vein = 1.0 - abs(2.0 * fbm(pw * 1.3 + 50.0) - 0.94);
  dust = max(dust, rs(0.70, 1.0, vein) * 0.38 * (0.3 + 0.7 * n2 * 2.0) * rs(0.20, 0.04, abs(b - mid)) * rs(-0.2, 0.7, cu));
  // 雲氣：一團團亮的恆星雲
  float t1 = fbm(pw * 1.5 + 31.0), t2 = fbm(d * 19.0 + 3.0);
  float cloud = (0.08 + 1.6 * t1) * (0.4 + 1.2 * t2);
  float dens = band * (0.40 + 0.55 * coreG + 0.5 * bulge) * cloud;
  // 核心偏暖（奶油黃），外側偏藍；最亮的地方接近白
  vec3 tint = mix(vec3(0.40, 0.56, 1.0), vec3(1.0, 0.75, 0.47), rs(0.02, 0.75, coreG + bulge * 0.4));
  tint = mix(tint, vec3(1.0, 0.95, 0.9), rs(0.7, 1.8, dens) * 0.3);
  // 外圍的顏色往夜空的深藍靠，跟周圍的天空接起來
  tint = mix(vec3(0.30, 0.44, 0.95), tint, rs(0.15, 0.85, band));
  col = tint * dens * 0.235;
  // 帶外一圈很淡的藍紫色
  col += vec3(0.24, 0.34, 0.80) * exp(-b * b / (2.0 * 0.16 * 0.16)) * (0.034 + 0.06 * t1) * (0.6 + 0.4 * t2);
  // 塵埃吸掉星光，藍的吸得比紅的多：雲的邊緣帶褐色
  col *= exp(-dust * vec3(1.9, 2.3, 2.75));
  // 粉紅色的發光星雲：中線附近幾小團，加一大片很淡的紫紅
  float nb = fbm(vec3(u * 8.0, b * 9.0, 41.0) + vec3(w * 0.8, 0.0));
  float neb = rs(0.56, 0.74, nb) * exp(-(b - mid) * (b - mid) / 0.008) * (1.0 - dust * 0.6);
  col += vec3(1.0, 0.30, 0.46) * neb * 0.22 * (0.4 + coreG);
  col += vec3(0.75, 0.30, 0.62) * band * rs(0.38, 0.62, fbm2(vec3(u * 2.3, b * 3.0, 17.0))) * 0.06 * (0.4 + coreG);
  float edge = rs(${MW_B.toFixed(2)}, ${(MW_B * 0.5).toFixed(2)}, abs(b)); // 貼圖邊界前淡出到 0
  gl_FragColor = vec4(sqrt(clamp(col * 0.5, 0.0, 1.0)) * edge, dust * edge);
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop, uHorizon, uSunDir, uSunCol;
uniform float uNight, uTime, uSunDisc, uStarBoost, uCloud;
uniform sampler2D uMW;
varying vec3 vDir;
${GLSL_NOISE}

// 小星的顏色：藍白最多，其次白、淡黃，少數橙
vec3 starTint(float t){
  return t < 0.5 ? mix(vec3(0.62, 0.76, 1.0), vec3(0.92, 0.95, 1.0), t * 2.0) : mix(vec3(1.0, 0.95, 0.82), vec3(1.0, 0.72, 0.46), rs(0.5, 1.0, t) * rs(0.5, 1.0, t));
}
vec3 milkyWay(vec3 d){
  float b = dot(d, ${v3(MW_N)});
  float cu = dot(d, ${v3(MW_C)});
  float u = atan(dot(d, ${v3(MW_U)}), cu);
  float coreG = pow(max(cu, 0.0), 7.0);
  float sigma = 0.072 + 0.085 * coreG;
  float band = 0.62 * exp(-b * b / (2.0 * sigma * sigma)) + 0.38 * exp(-b * b / (2.0 * sigma * sigma * 6.5));
  float halo = exp(-b * b / (2.0 * 0.25 * 0.25));
  // 雲氣、塵埃、星雲：取烘焙好的貼圖
  vec4 mw = texture2D(uMW, vec2(u / 6.2831853 + 0.5, clamp(b / ${(MW_B * 2).toFixed(2)} + 0.5, 0.0, 1.0)));
  vec3 col = mw.rgb * mw.rgb * 2.0;
  float dust = mw.a;
  for (int k = 0; k < 3; k++) {
    float sc = k == 0 ? 150.0 : k == 1 ? 250.0 : 400.0;
    vec3 q = d * sc; vec3 cell = floor(q); vec3 f = fract(q) - 0.5;
    float h = hash1(cell + float(k) * 17.0);
    float inBand = band * (0.30 + 0.5 * coreG) * (1.0 - dust * 0.85);
    float prob = (k == 2 ? 0.035 + inBand * 2.2 : 0.05 + inBand * 1.3) + halo * (k == 2 ? 0.16 : 0.07); // 帶外的星也是越靠近銀河越密
    float rr = length(f + (vec3(hash1(cell + 3.0), hash1(cell + 5.0), hash1(cell + 7.0)) - 0.5) * 0.4);
    float m = fract(h * 71.0); m = m * m * m; // 星等：暗的多、亮的少
    float star = step(1.0 - prob, h) * rs(0.20 + 0.14 * m, 0.0, rr);
    float tw = 0.78 + 0.22 * sin(uTime * (1.0 + h * 3.0) + h * 90.0);
    col += star * tw * (0.16 + 1.25 * m) * starTint(fract(h * 13.0)) * (k == 0 ? 1.15 : k == 1 ? 0.8 : 0.55) * (1.0 - dust * 0.5);
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
  // 海平線上的一排積雲：有高有低、底部平、頂部一團團，天空在最遠的山後面才不會是空的
  if (d.y > -0.01) {
    float az = atan(d.x, -d.z), e = d.y;
    float top = 0.028 + 0.12 * rs(0.3, 0.75, fbm2(vec3(az * 1.9, 0.0, 4.0))) + 0.035 * fbm2(vec3(az * 7.0, 1.0, 2.0));
    float puff = fbm(vec3(az * 11.0 + uTime * 0.0015, e * 46.0, 6.0));
    float cb = rs(top, top * 0.3, e + (0.5 - puff) * 0.07) * rs(-0.004, 0.012, e);
    // 底部是藍灰的陰影、頂部受光；夜裡只是比天空略亮的一抹
    vec3 lit = mix(mix(uHorizon, uTop, 0.5) * 0.9, mix(uHorizon, vec3(1.0), 0.85) * (0.8 + 0.4 * uSunDisc), rs(0.1, 0.9, (e + (puff - 0.5) * 0.06) / top));
    lit = mix(lit, uSunCol, 0.25 * (1.0 - uSunDisc) * (1.0 - uNight));
    lit = mix(lit, uHorizon * 1.5 + vec3(0.004, 0.006, 0.01), uNight);
    c = mix(c, lit, cb * mix(0.9, 0.7, uNight));
  }
  // 夜晚：山後面遠方城市映在低空的微光
  if (uNight > 0.01) {
    float az = atan(d.x, -d.z);
    float lobe = exp(-(az - 0.62) * (az - 0.62) / 0.10) + 0.7 * exp(-(az + 0.95) * (az + 0.95) / 0.16) + 0.25;
    c += vec3(1.0, 0.6, 0.32) * 0.05 * lobe * exp(-max(d.y, 0.0) * 13.0) * uNight;
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
attribute vec4 aStar; // 顏色 rgb、亮度（1 以上是少數特別亮的一等星，帶一圈光暈）
attribute float aPhase;
uniform float uTime, uNight, uPx, uStarBoost;
varying vec4 vCol; varying float vGlow;
void main(){
  vec3 d = normalize(position);
  float ext = smoothstep(-0.01, 0.2, d.y);
  float tw = 0.8 + 0.2 * sin(uTime * (1.5 + aPhase * 4.0) + aPhase * 60.0) * (1.4 - d.y);
  float b = aStar.w * tw * ext * uNight * uNight * (0.7 + 0.3 * uStarBoost);
  vCol = vec4(aStar.rgb, b);
  vGlow = clamp((aStar.w - 0.8) / 0.8, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.3 + min(aStar.w, 1.0) * 2.4 + vGlow * 9.0) * uPx;
}`;
const starFrag = /* glsl */ `
varying vec4 vCol; varying float vGlow;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  // 亮星的點比較大，但核心一樣小，多出來的是一圈淡淡的光暈
  float core = exp(-r * mix(4.5, 42.0, vGlow));
  float halo = vGlow * 0.10 * (1.0 - sqrt(r)) * (1.0 - sqrt(r));
  gl_FragColor = vec4(mix(vCol.rgb, vec3(1.0), core * 0.5 * vGlow) * (core + halo) * vCol.a * 1.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SKY_K = 16; // 流星的尺度（原本以 700 公尺設計，配合放大的天球）

// 把銀河畫成貼圖（只做一次）
function bakeMilkyWay(renderer) {
  const rt = new THREE.WebGLRenderTarget(4096, 1024, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const mat = new THREE.ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: bakeFrag, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const sc = new THREE.Scene();
  sc.add(quad);
  renderer.setRenderTarget(rt);
  renderer.render(sc, new THREE.Camera());
  renderer.setRenderTarget(null);
  mat.dispose(); quad.geometry.dispose();
  return rt.texture;
}

export function createSky(scene, renderer) {
  let seed = 424242;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  // --- 天球 ---
  const uniforms = {
    uTop: G.skyTop, uHorizon: G.skyHorizon, uSunDir: G.sunDir, uSunCol: G.sunCol,
    uNight: G.night, uTime: G.uTime, uStarBoost: G.starBoost,
    uSunDisc: { value: 1 }, uCloud: { value: 1 }, uMW: { value: bakeMilkyWay(renderer) },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(60000, 48, 24), // 比遠景的地形（46 公里）還大，星星才會被山擋住
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: skyFrag,
    })
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // --- 亮星：約 3400 顆，三成五集中在銀河帶附近（往銀心更密）---
  // 色溫：藍白（O、B）、白（A）、黃白（F、G）、橙（K）、紅（M），亮星裡紅的少
  const TEMPS = [[0.26, [0.62, 0.75, 1.0]], [0.30, [0.86, 0.91, 1.0]], [0.22, [1.0, 0.95, 0.82]], [0.15, [1.0, 0.78, 0.52]], [0.07, [1.0, 0.60, 0.42]]];
  const N = 3400, pos = [], star = [], phase = [];
  const d = new THREE.Vector3(), t = new THREE.Vector3(), u = MW_U;
  for (let i = 0; i < N; i++) {
    if (rand() < 0.35) {
      // 銀河帶上：沿大圓取一點（一半偏向銀心那一側），再往法向偏一點
      const a = rand() < 0.5 ? (rand() + rand() - 1) * 1.5 : rand() * Math.PI * 2, off = (rand() + rand() + rand() - 1.5) * 0.14;
      d.copy(MW_C).multiplyScalar(Math.cos(a)).addScaledVector(u, Math.sin(a)).addScaledVector(MW_N, off).normalize();
    } else {
      d.set(rand() * 2 - 1, rand() * 1.15 - 0.15, rand() * 2 - 1);
      if (d.lengthSq() > 1 || d.lengthSq() < 0.01) { i--; continue; }
      d.normalize();
    }
    if (d.y < -0.05) { i--; continue; }
    t.copy(d).multiplyScalar(58000);
    pos.push(t.x, t.y, t.z);
    // 星等：暗星多、亮星少；最前面的 26 顆是特別亮的一等星
    const w = i < 26 ? 1.0 + rand() * 0.7 : 0.13 + Math.pow(rand(), 5.5) * 0.87;
    let r = rand(), col = TEMPS[0][1];
    for (const [p, c] of TEMPS) { if ((r -= p) < 0) { col = c; break; } }
    star.push(col[0], col[1], col[2], w);
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
