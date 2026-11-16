// 植栽：場內的楓樹、場外的樹林、地面與水面的落葉。
// 楓樹：程序長出彎曲的枝幹（管狀網格），葉子是一張張「帶著十來片楓葉的小枝」貼片（InstancedMesh）。
// 場外樹林用較大的葉叢貼片包住一個深色的芯，數量少很多。
// 葉片共用一份材質：頂點 shader 做微風搖曳，片段 shader 加上逆光透亮與夜晚燈火的暖色。
import * as THREE from 'three';
import * as L from './layout.js';
import { G } from './env.js';
import { patch } from './shaders.js';
import { OVERHEAD, MATERIALS, fbm, rng } from './world.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

// ---------- 貼圖（畫在 canvas 上，白底色，實際顏色由每片的 instanceColor 決定） ----------
const LOBES = [[-128, 0.42], [-88, 0.72], [-45, 0.95], [0, 1.0], [45, 0.95], [88, 0.72], [128, 0.42]];
const polar = (deg, r) => { const a = ((deg - 90) * Math.PI) / 180; return [Math.cos(a) * r, Math.sin(a) * r]; };

function mapleLeafPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(...polar(180, 0.06 * s));
  LOBES.forEach(([d, len], i) => {
    const w = 15 - Math.abs(d) * 0.03, l = len * s;
    if (i) ctx.lineTo(...polar((d + LOBES[i - 1][0]) / 2, (0.22 + 0.1 * Math.min(len, LOBES[i - 1][1])) * s));
    ctx.lineTo(...polar(d - w, l * 0.46));
    ctx.lineTo(...polar(d - w * 0.62, l * 0.7));
    ctx.lineTo(...polar(d - w * 0.42, l * 0.66));
    ctx.lineTo(...polar(d, l));
    ctx.lineTo(...polar(d + w * 0.42, l * 0.66));
    ctx.lineTo(...polar(d + w * 0.62, l * 0.7));
    ctx.lineTo(...polar(d + w, l * 0.46));
  });
  ctx.closePath();
}

// 一片楓葉：葉基在 (x, y)，葉尖朝 ang（canvas 角度）
function drawMapleLeaf(ctx, x, y, ang, s, rand) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang + Math.PI / 2);
  const g = 196 + rand() * 59, warm = rand();
  const col = (k) => `rgb(${Math.round(g * k)},${Math.round(g * k * (0.86 + 0.14 * warm))},${Math.round(g * k * (0.7 + 0.3 * warm))})`;
  const grad = ctx.createRadialGradient(0, -0.3 * s, 0, 0, -0.3 * s, s);
  grad.addColorStop(0, col(1)); grad.addColorStop(1, col(0.8));
  mapleLeafPath(ctx, s);
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = 'rgba(60,20,10,0.22)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(70,30,20,0.3)'; ctx.lineWidth = Math.max(1, s * 0.018);
  ctx.beginPath();
  for (const [d, len] of LOBES) { ctx.moveTo(0, 0); ctx.lineTo(...polar(d, len * s * 0.88)); }
  ctx.stroke();
  ctx.restore();
}

// 楓枝：一段細枝，對生的葉子一對對長出去
function drawSprig(ctx, rand) {
  const b1 = (rand() - 0.5) * 90, b2 = (rand() - 0.5) * 120;
  const P = (t) => { const u = 1 - t; return [256 + 2 * u * t * b1 + t * t * b2, 512 - 2 * u * t * 190 - t * t * 330]; };
  ctx.strokeStyle = '#3a2c28'; ctx.lineCap = 'round';
  for (let i = 0; i < 20; i++) {
    ctx.lineWidth = 6.5 - i * 0.2;
    ctx.beginPath(); ctx.moveTo(...P(i / 20)); ctx.lineTo(...P((i + 1) / 20)); ctx.stroke();
  }
  const nodes = [0.2, 0.42, 0.62, 0.82, 1];
  nodes.forEach((t, k) => {
    const [x, y] = P(t), [x2, y2] = P(Math.min(1, t + 0.02)), [x1, y1] = P(Math.max(0, t - 0.02));
    const th = Math.atan2(y2 - y1, x2 - x1);
    const offs = t === 1 ? [-0.95, 0.9, 0] : [-(0.9 + rand() * 0.45), 0.9 + rand() * 0.45];
    for (const o of offs) {
      const a = th + o + (rand() - 0.5) * 0.25, pl = 30 + rand() * 22, s = (92 - k * 5) * (0.82 + rand() * 0.3);
      const lx = x + Math.cos(a) * pl, ly = y + Math.sin(a) * pl;
      ctx.strokeStyle = '#5a3028'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(lx, ly); ctx.stroke();
      drawMapleLeaf(ctx, lx, ly, a + (rand() - 0.5) * 0.4, s, rand);
    }
  });
}

// 闊葉叢：三十多片卵形葉子
function drawClump(ctx, rand) {
  for (let i = 0; i < 40; i++) {
    const r = 195 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
    const x = 256 + Math.cos(a) * r, y = 256 + Math.sin(a) * r * 0.95, s = 58 + rand() * 34;
    const g = 150 + (i / 40) * 70 + rand() * 35;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a + Math.PI / 2 + (rand() - 0.5) * 1.6);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(0.52 * s, -0.12 * s, 0.4 * s, -0.78 * s, 0, -s);
    ctx.bezierCurveTo(-0.4 * s, -0.78 * s, -0.52 * s, -0.12 * s, 0, 0);
    ctx.fillStyle = `rgb(${g | 0},${(g * 0.94) | 0},${(g * 0.82) | 0})`; ctx.fill();
    ctx.strokeStyle = 'rgba(40,25,10,0.3)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.9); ctx.stroke();
    ctx.restore();
  }
}

// 杉葉：一條主枝，兩側的小枝上密生短針
function drawSugi(ctx, rand) {
  const needle = (x, y, a, len, g) => {
    ctx.strokeStyle = `rgb(${(g * 0.9) | 0},${g | 0},${(g * 0.84) | 0})`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  };
  const spray = (x0, y0, a, len, depth) => {
    const n = Math.floor(len / 7);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + Math.cos(a) * len * t, y = y0 + Math.sin(a) * len * t;
      ctx.lineWidth = 4.2 - t * 1.5;
      const g = 150 + rand() * 95;
      for (const sd of [-1, 1]) needle(x, y, a + sd * (0.55 + rand() * 0.3), (15 + rand() * 9) * (1 - t * 0.4), g);
      if (depth && i > 1 && i % 5 === 0) for (const sd of [-1, 1]) spray(x, y, a + sd * (0.6 + rand() * 0.25), len * (0.42 - t * 0.2), 0);
    }
    needle(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len, a, 16, 210);
  };
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#4a3a2c'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(256, 512); ctx.lineTo(256, 80); ctx.stroke();
  for (let y = 490; y > 90; y -= 34) {
    const k = (y - 90) / 400;
    for (const sd of [-1, 1]) spray(256, y + rand() * 12, -Math.PI / 2 + sd * (0.75 + rand() * 0.3), 60 + 150 * Math.sin(Math.min(1, k * 1.25) * Math.PI * 0.62) + rand() * 20, 1);
  }
  spray(256, 110, -Math.PI / 2, 90, 1);
}

// canvas 轉成貼圖。透明處的顏色填成該格葉子的平均色（canvas 預設是黑的，縮小取樣時葉緣會出現黑邊）
function toTexture(canvas, tile = canvas.width) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 4);
  for (let ty = 0; ty < h; ty += tile) for (let tx = 0; tx < w; tx += tile) {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = ty; y < ty + tile; y++) for (let x = tx; x < tx + tile; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] > 200) { sum[0] += src[i]; sum[1] += src[i + 1]; sum[2] += src[i + 2]; n++; }
    }
    const avg = sum.map((v) => Math.round(v / Math.max(1, n)));
    for (let y = ty; y < ty + tile; y++) for (let x = tx; x < tx + tile; x++) {
      const i = (y * w + x) * 4, o = ((h - 1 - y) * w + x) * 4, a = src[i + 3];
      if (a < 12) { out[o] = avg[0]; out[o + 1] = avg[1]; out[o + 2] = avg[2]; out[o + 3] = 0; }
      else { out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = a; }
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// 2×2 圖集：0、1 = 楓枝，2 = 闊葉叢，3 = 杉葉
function atlasTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const rand = rng(4107);
  [drawSprig, drawSprig, drawClump, drawSugi].forEach((draw, t) => {
    ctx.save();
    ctx.translate((t % 2) * 512, (1 - Math.floor(t / 2)) * 512);
    ctx.beginPath(); ctx.rect(0, 0, 512, 512); ctx.clip();
    draw(ctx, rand);
    ctx.restore();
  });
  return toTexture(c, 512);
}

// 單獨一片楓葉（落葉用；4C 飄落的葉子也用這張）
function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.strokeStyle = '#6a4030'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(128, 178); ctx.quadraticCurveTo(132, 215, 122, 246); ctx.stroke();
  drawMapleLeaf(ctx, 128, 178, -Math.PI / 2, 150, () => 0.85);
  return toTexture(c);
}

// ---------- 葉片材質 ----------
const WIND_VERT = /* glsl */ `
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    vec3 ip = instanceMatrix[3].xyz;
  #else
    vec3 ip = mvPosition.xyz;
  #endif
  {
    float t = uTime, ph = aFx.y * 6.283;
    // 一陣一陣的風：整片樹冠的強弱緩慢起伏
    float gust = 0.55 + 0.45 * sin(t * 0.35 + ip.x * 0.11 + ip.z * 0.07);
    // 枝條緩慢擺動（整張貼片一起動）
    vec3 sway = vec3(sin(t * 0.9 + ip.x * 0.35 + ip.z * 0.2), sin(t * 1.3 + ph) * 0.35, cos(t * 0.7 + ip.z * 0.3)) * 0.03;
    // 葉片本身的顫動（離枝越遠越大）
    vec3 fl = vec3(sin(t * 3.1 + ph), cos(t * 2.3 + ph * 1.7), sin(t * 2.7 + ph * 0.6)) * 0.018 * uv.y;
    mvPosition.xyz += (sway + fl) * gust * aFx.z * (1.0 + uShake * 6.0);
  }
  vFWPos = mvPosition.xyz;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`;

function inject(shader, uShake, lit) {
  shader.uniforms.uTime = G.uTime;
  shader.uniforms.uShake = uShake;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec3 aNrm; attribute vec3 aFx;
      uniform float uTime, uShake;
      varying vec3 vFWPos; varying vec3 vFWN;`)
    .replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = (vMapUv + vec2(mod(aFx.x, 2.0), floor(aFx.x * 0.5))) * 0.5;
      #endif`)
    .replace('#include <project_vertex>', WIND_VERT);
  if (!lit) return;
  Object.assign(shader.uniforms, { uNight: G.night, uSunDir: G.sunDir, uSunCol: G.sunCol, uLampPos: G.lampPos, uLampCol: G.lampCol });
  shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>', `
      // 法線大半改用「從樹冠中心往外」的方向，整棵樹的明暗才會成團，不會每片各亮各的
      vec3 transformedNormal = objectNormal;
      #ifdef USE_INSTANCING
        transformedNormal = mat3(instanceMatrix) * transformedNormal;
      #endif
      transformedNormal = normalize(mix(normalize(transformedNormal), aNrm, 0.72));
      vFWN = transformedNormal;
      transformedNormal = normalMatrix * transformedNormal;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uNight; uniform vec3 uSunDir, uSunCol, uLampCol; uniform vec4 uLampPos[16];
      varying vec3 vFWPos; varying vec3 vFWN;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      // 遠處貼圖縮小後葉子會變細、樹冠變稀，補一點回來
      diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + smoothstep(4.0, 30.0, length(vViewPosition)) * 1.3));`)
    .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize(vNormal);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 wn = normalize(vFWN), vd = normalize(vFWPos - cameraPosition);
        // 逆光透亮：背對太陽的葉子、以及朝太陽方向看過去的葉子
        float tr = max(0.0, dot(-wn, uSunDir)) * 0.5 + pow(max(0.0, dot(vd, uSunDir)), 2.0) * 0.9;
        totalEmissiveRadiance += diffuseColor.rgb * uSunCol * tr * (1.0 - uNight) * (1.0 - uNight);
        // 夜晚：燈火穿過葉片的暖色
        float lamp = 0.0;
        for (int i = 0; i < 16; i++) { vec3 d = uLampPos[i].xyz - vFWPos; lamp += uLampPos[i].w / (1.0 + dot(d, d) * 0.5); }
        totalEmissiveRadiance += diffuseColor.rgb * uLampCol * lamp * 0.9;
      }`);
}

function foliageMaterial(map) {
  const uShake = { value: 0 };
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.38, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.75 });
  m.onBeforeCompile = (s) => inject(s, uShake, true);
  m.customProgramCacheKey = () => 'foliage';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.3, side: THREE.DoubleSide });
  depth.onBeforeCompile = (s) => inject(s, uShake, false);
  depth.customProgramCacheKey = () => 'foliage-depth';
  return { material: m, depth, uShake };
}

// ---------- 貼片的集合 ----------
function cardGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 2, 2);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  // 兩側與末端微微下垂
  for (let i = 0; i < p.count; i++) p.setZ(i, -(p.getX(i) ** 2) * 0.5 - (p.getY(i) ** 2) * 0.12);
  g.computeVertexNormals();
  return g;
}

class Cards {
  constructor() { this.m = []; this.c = []; this.n = []; this.fx = []; this.count = 0; }
  // p：附著點；dir：貼片伸出去的方向；nrm：貼片正面朝向；puff：打光用的法線
  add(p, dir, nrm, size, color, puff, tile, flex, rand) {
    const y = _y.copy(dir).normalize();
    const z = _z.copy(nrm).addScaledVector(y, -nrm.dot(y));
    if (z.lengthSq() < 1e-4) z.set(y.z, y.x, y.y).addScaledVector(y, -z.dot(y));
    z.normalize();
    const x = _x.crossVectors(y, z);
    _m.makeBasis(x, y, z).scale(_s.set(size, size, size)).setPosition(p);
    this.m.push(..._m.elements);
    this.c.push(color.r, color.g, color.b);
    this.n.push(puff.x, puff.y, puff.z);
    this.fx.push(tile, rand(), flex);
    this.count++;
  }
  build(fol, shadow = true) {
    const g = cardGeometry();
    g.setAttribute('aNrm', new THREE.InstancedBufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('aFx', new THREE.InstancedBufferAttribute(new Float32Array(this.fx), 3));
    const mesh = new THREE.InstancedMesh(g, fol.material, this.count);
    mesh.instanceMatrix.array.set(this.m);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
    mesh.customDepthMaterial = fol.depth;
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    return mesh;
  }
}
const _x = new V3(), _y = new V3(), _z = new V3(), _s = new V3(), _m = new THREE.Matrix4();

// ---------- 枝幹 ----------
const newWood = () => ({ pos: [], nrm: [], idx: [] });

// 沿一串點拉出一根逐漸變細的管子
function tube(W, pts, radii, sides) {
  const base = W.pos.length / 3, T = new V3(), N = new V3(), B = new V3();
  for (let i = 0; i < pts.length; i++) {
    T.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    if (i === 0) N.set(1, 0, 0).addScaledVector(T, -T.x);
    else N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-6) N.set(0, 0, 1).addScaledVector(T, -T.z);
    N.normalize();
    B.crossVectors(T, N);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const nx = N.x * c + B.x * sn, ny = N.y * c + B.y * sn, nz = N.z * c + B.z * sn;
      W.pos.push(pts[i].x + nx * radii[i], pts[i].y + ny * radii[i], pts[i].z + nz * radii[i]);
      W.nrm.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    W.idx.push(a, b, c, b, d, c);
  }
}

function woodMesh(W, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(W.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(W.nrm, 3));
  g.setIndex(W.idx);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// 繞著 d 偏開 spread 弧度、方位角 az 的方向
function deviate(d, spread, az, out) {
  const u = _x.set(d.y, d.z, d.x).addScaledVector(d, -(d.x * d.y + d.y * d.z + d.z * d.x)).normalize();
  const v = _z.crossVectors(d, u);
  return out.copy(d).multiplyScalar(Math.cos(spread))
    .addScaledVector(u, Math.cos(az) * Math.sin(spread)).addScaledVector(v, Math.sin(az) * Math.sin(spread)).normalize();
}

// 枝葉不能伸進去的空間（湯屋含屋頂、東屋含屋頂）
function blocked(q, m = 0) {
  const Y = L.YUYA, A = L.AZUMAYA;
  if (q.x > Y.x0 - 0.8 - m && q.x < Y.x1 + 0.8 + m && q.z > 7.9 - m && q.y < 7.6 + m) return true;
  if (q.x > A.x0 - 0.55 - m && q.x < A.x1 + 0.55 + m && q.z > A.z0 - 0.8 - m && q.z < A.z1 + 0.8 + m && q.y < 4.15 + m) return true;
  return false;
}

// ---------- 楓樹 ----------
const GRAD = [0x8f1a18, 0xc0241a, 0xdb461c, 0xe6741f, 0xeb9c28, 0xedc03a].map((h) => new THREE.Color(h));
function gradColor(t, out) {
  t = Math.min(GRAD.length - 1.001, Math.max(0, t));
  const i = Math.floor(t);
  return out.copy(GRAD[i]).lerp(GRAD[i + 1], t - i);
}
// 每棵樹的主色（0 深紅 … 5 金黃）
const TREE_HUE = [1.3, 2.3, 3.7, 1.0, 4.4, 2.7, 1.7];
const MIN_LEAF_Y = 2.0; // 葉片最低高度（不擋到走路的視線）
const SIDES = [10, 8, 6, 5, 4, 3];

function growMaple([x, z, h, r], idx, rand, W) {
  const MAXL = 5;
  const lean = new V3(L.POOL.cx - x, 0, L.POOL.cz - z).normalize().multiplyScalar(0.1 + rand() * 0.1);
  lean.x += (rand() - 0.5) * 0.2; lean.z += (rand() - 0.5) * 0.2;
  const C = new V3(x + lean.x * h * 0.9, h * 0.66, z + lean.z * h * 0.9);
  const R = new V3(r, h * 0.36, r);
  const anchors = [];
  let fork = null;
  const e = new V3();

  function branch(p0, d0, len, rad, level) {
    const segs = level === 0 ? 7 : level < 3 ? 6 : 4;
    const endRad = level === MAXL ? 0.004 : rad * 0.8;
    const pts = [p0.clone()], radii = [rad], p = p0.clone(), d = d0.clone();
    let stopped = false;
    for (let i = 1; i <= segs; i++) {
      const wob = level === 0 ? 0.15 : 0.2 + level * 0.03;
      d.x += (rand() - 0.5) * wob * 2; d.y += (rand() - 0.5) * wob * 1.4; d.z += (rand() - 0.5) * wob * 2;
      if (level === 0) d.y += 0.3;
      else if (level <= 2) d.y += 0.05;
      else d.y = d.y * 0.86 - 0.02 * (level - 2); // 細枝趨向水平，末端微垂（楓樹一層一層的樣子）
      if (level > 0) {
        e.subVectors(p, C).divide(R);
        const el = e.length();
        if (el > 0.78) d.addScaledVector(e.divide(R).normalize(), -(el - 0.78) * 2.6);
        if (p.y < 2.4) d.y += 0.4;
      }
      d.normalize();
      const q = p.clone().addScaledVector(d, len / segs);
      if (blocked(q, 0.3)) {
        d.y += 0.9; d.z -= q.z > 7 ? 0.5 : 0; d.normalize();
        q.copy(p).addScaledVector(d, len / segs);
        if (blocked(q, 0.3)) { stopped = true; break; }
      }
      p.copy(q); pts.push(p.clone());
      radii.push(rad + (endRad - rad) * (i / segs));
      if (level >= MAXL - 1) anchors.push({ p: p.clone(), d: d.clone() });
    }
    if (level === 0) { radii[0] *= 1.6; radii[1] *= 1.15; fork = { p: p.clone(), rad: endRad }; }
    if (pts.length > 1) tube(level === 0 ? W.trunk : W.branch, pts, radii, SIDES[level]);
    if (stopped || level === MAXL) return;
    const n = level === 0 ? 3 + (rand() < 0.5 ? 1 : 0) : 2;
    const a0 = rand() * 6.283, cd = new V3();
    for (let k = 0; k < n; k++) {
      const spread = level === 0 ? 0.7 + rand() * 0.35 : 0.38 + rand() * 0.45;
      deviate(d, spread, a0 + (k * 6.283) / n + (rand() - 0.5) * 0.6, cd);
      branch(p, cd, level === 0 ? h * 0.3 : len * (0.74 + rand() * 0.16), endRad * (n > 2 ? 0.72 : 0.84), level + 1);
    }
    if (level >= 1 && rand() < 0.62) {
      const k = 2 + Math.floor(rand() * (pts.length - 3));
      deviate(d, 0.9 + rand() * 0.4, rand() * 6.283, cd);
      branch(pts[k], cd, len * 0.66, radii[k] * 0.55, level + 1);
    }
  }
  branch(new V3(x, -0.15, z), new V3(lean.x, 1, lean.z).normalize(), Math.max(h * 0.3, 1.9), 0.075 + h * 0.009, 0);
  return { anchors, C, R, fork, hue: TREE_HUE[idx % TREE_HUE.length], idx };
}

// 在枝梢上掛葉片
function leafMaple(tree, count, cards, rand, minY = MIN_LEAF_Y) {
  const { anchors, C, R, hue, idx } = tree;
  if (!anchors.length) return;
  const p = new V3(), dir = new V3(), nrm = new V3(), puff = new V3(), col = new THREE.Color(), tip = new V3();
  for (let i = 0, tries = 0; i < count && tries < count * 4; tries++) {
    const a = anchors[Math.floor(rand() * anchors.length)];
    p.copy(a.p); p.x += (rand() - 0.5) * 0.24; p.y += (rand() - 0.5) * 0.16; p.z += (rand() - 0.5) * 0.24;
    const az = rand() * 6.283;
    dir.set(a.d.x * 0.5 + Math.cos(az) * 0.9, -0.12 + (rand() - 0.5) * 0.4, a.d.z * 0.5 + Math.sin(az) * 0.9).normalize();
    const size = 0.42 + rand() * 0.2;
    tip.copy(p).addScaledVector(dir, size);
    if (Math.min(p.y, tip.y) - 0.08 < minY || blocked(tip, 0.1) || blocked(p, 0.1)) continue;
    // 多數葉片近乎水平地一層層攤開，少數斜立，從側面看才不會太稀
    const flat = rand() < 0.68 ? 0.4 : 1.6;
    nrm.set((rand() - 0.5) * flat, flat > 1 ? 0.5 : 1, (rand() - 0.5) * flat);
    puff.subVectors(p, C).divide(R);
    const depth = Math.min(1.2, puff.length());
    puff.normalize().lerp(UP, 0.25).normalize();
    const t = hue + (fbm(p.x * 0.55 + idx * 7.3, p.y * 0.55, p.z * 0.55) - 0.47) * 4.6 + (rand() - 0.5) * 0.8 + (0.75 - depth) * 1.3;
    const k = Math.min(1, Math.max(0, (depth - 0.25) / 0.75));
    const ao = (0.52 + 0.48 * k * k * (3 - 2 * k)) * (0.84 + rand() * 0.3);
    gradColor(t, col).multiplyScalar(ao);
    cards.add(p, dir, nrm, size, col, puff, rand() < 0.5 ? 0 : 1, 1, rand);
    i++;
  }
}

// 可搖落紅葉的低垂枝：從樹的分岔處伸到小徑上方
function lowBranch(tree, W, cards, rand) {
  const P = L.PROPS.mapleBranch, a = tree.fork.p;
  const tipP = new V3(P.x + 0.12, 2.12, P.z - 0.5);
  const c1 = new V3(a.x, a.y + 0.95, a.z - 0.35), c2 = new V3(tipP.x - 0.1, tipP.y + 0.7, tipP.z + 0.75);
  const curve = new THREE.CubicBezierCurve3(a.clone(), c1, c2, tipP);
  const pts = curve.getPoints(10), radii = pts.map((_, i) => 0.05 - (i / 10) * 0.042);
  tube(W.branch, pts, radii, 6);
  const anchors = [];
  for (let i = 5; i <= 10; i++) {
    const d = curve.getTangent(i / 10);
    anchors.push({ p: pts[i].clone(), d });
    if (i === 10) break;
    // 兩側的小枝
    const side = i % 2 ? 1 : -1, tw = [pts[i].clone()], q = pts[i].clone();
    const td = new V3(d.x * 0.5 + side * (0.8 + rand() * 0.3), -0.02, d.z * 0.5 + side * (rand() - 0.5) * 0.4).normalize();
    for (let k = 0; k < 4; k++) {
      td.y -= 0.05; td.normalize();
      q.addScaledVector(td, 0.11 + rand() * 0.05);
      tw.push(q.clone());
      anchors.push({ p: q.clone(), d: td.clone() });
    }
    tube(W.branch, tw, [radii[i] * 0.5, 0.008, 0.006, 0.005, 0.003], 4);
  }
  const C = new V3(P.x, 1.6, P.z), R = new V3(1.2, 1.2, 1.2);
  leafMaple({ anchors, C, R, hue: tree.hue - 0.4, idx: tree.idx }, 150, cards, rand, 1.84);
  return new V3(P.x, 2.1, P.z - 0.1);
}

// ---------- 場外樹林 ----------
const SUGI_GREEN = [0x1c3522, 0x2c4a2c, 0x3b5a30, 0x565230].map((h) => new THREE.Color(h));
const BROAD = [0xa3261b, 0xc2521c, 0xd3811f, 0xd9a72b, 0xc9b53c, 0x8f5a26, 0xb8862a, 0x6a7430].map((h) => new THREE.Color(h));

// 一棵場外的樹。y 是樹根的地面高度；lite 時用較少、較大的貼片（遠一點的山坡上），maxH 限制樹高（不擋視線）
function plantTree(rand, W, cards, core, x, y, z, { lite = false, maxH = 99, kind } = {}) {
  const col = new THREE.Color(), p = new V3(), dir = new V3(), nrm = new V3(), puff = new V3(), out = new V3(), u = new V3();
  const lump = (geo, cx, cy, cz, sx, sy, sz, c) => {
    const g = geo.toNonIndexed(), q = g.attributes.position;
    for (let i = 0; i < q.count; i++) {
      core.pos.push(cx + q.getX(i) * sx, cy + q.getY(i) * sy, cz + q.getZ(i) * sz);
      core.col.push(c.r, c.g, c.b);
    }
  };
  const bx = (rand() - 0.5) * 0.5, bz = (rand() - 0.5) * 0.5;
  const base = lite ? y - 1.2 : y - 0.2; // 坡上的樹根埋深一點，下坡那側才不會懸空
  if (kind === 'sugi' || (kind === undefined && rand() < 0.42)) {
    // 杉：筆直的幹、細長的圓錐形樹冠，枝葉下垂
    const h = Math.min(maxH, 13 + rand() * 7), y0 = h * (0.24 + rand() * 0.1), R0 = (1.9 + rand() * 0.9) * Math.min(1, h / 13 + 0.15), top = h + 0.5;
    tube(W, [new V3(x, base, z), new V3(x + bx * 0.4, y + h * 0.5, z + bz * 0.4), new V3(x + bx, y + h, z + bz)], [0.34, 0.2, 0.03], lite ? 5 : 7);
    lump(CONE, x + bx * 0.7, y + (y0 + top) / 2 - 0.4, z + bz * 0.7, R0 * 0.5, top - y0 - 0.8, R0 * 0.5, col.setHex(0x101c14));
    const n = lite ? 85 : 260, big = lite ? 1.5 : 1;
    for (let k = 0; k < n; k++) {
      const t = k < (lite ? 7 : 20) ? 0.8 + rand() * 0.2 : 1 - Math.sqrt(1 - rand() * 0.98), yy = y0 + t * (top - y0), rc = R0 * (1 - t) + 0.22, az = rand() * 6.283;
      out.set(Math.cos(az), 0, Math.sin(az));
      const size = Math.min(2.4 * big, (rc * 0.8 + 0.7) * big) * (0.75 + rand() * 0.5);
      // 枝條先往外伸、末端下垂；越靠樹頂垂得越直，收成尖頂
      const droop = -(0.35 + rand() * 0.75) - t * 0.6;
      dir.set(out.x + (rand() - 0.5) * 0.5, droop, out.z + (rand() - 0.5) * 0.5).normalize();
      p.set(x + bx * (yy / h) + out.x * rc * 0.45, y + yy, z + bz * (yy / h) + out.z * rc * 0.45);
      nrm.set(out.x * 0.5 + (rand() - 0.5) * 0.9, 0.8, out.z * 0.5 + (rand() - 0.5) * 0.9);
      puff.copy(out).lerp(UP, 0.35).normalize();
      const g = rand();
      col.copy(SUGI_GREEN[g < 0.4 ? 0 : g < 0.75 ? 1 : g < 0.9 ? 2 : 3]).multiplyScalar((0.6 + rand() * 0.5) * (0.7 + 0.3 * t));
      cards.add(p, dir, nrm, size, col, puff, 3, 2.2, rand);
    }
  } else {
    // 闊葉樹：幾團葉叢疊成的圓頂
    const h = Math.min(maxH, 8 + rand() * 5.5), b = BROAD[Math.floor(rand() * BROAD.length)], w = Math.min(1, h / 8 + 0.2);
    tube(W, [new V3(x, base, z), new V3(x + bx, y + h * 0.45, z + bz), new V3(x + bx * 2, y + h * 0.82, z + bz * 2)], [0.3, 0.19, 0.06], lite ? 5 : 7);
    const lumps = [[x + bx, y + h * 0.74, z + bz, 1.9 + rand() * 0.5]];
    for (let k = 0; k < (lite ? 4 : 7); k++) lumps.push([x + (rand() - 0.5) * 4.6 * w, y + h * (0.48 + rand() * 0.44), z + (rand() - 0.5) * 4.6 * w, (1.0 + rand() * 1.0) * (lite ? 1.2 : 1)]);
    const per = lite ? 18 : 40, big = lite ? 1.5 : 1;
    for (const [cx, cy, cz, rad] of lumps) {
      lump(ICO, cx, cy, cz, rad * 0.62, rad * 0.5, rad * 0.62, col.copy(b).multiplyScalar(0.2));
      for (let k = 0; k < per; k++) {
        u.set(rand() - 0.5, rand() - 0.32, rand() - 0.5).normalize();
        dir.set(rand() - 0.5, rand() - 0.75, rand() - 0.5);
        dir.addScaledVector(u, -dir.dot(u)).normalize().addScaledVector(u, 0.2 + rand() * 0.7).normalize();
        const size = (1.1 + rand() * 1.0) * big;
        p.set(cx + u.x * rad * 0.7, cy + u.y * rad * 0.6, cz + u.z * rad * 0.7).addScaledVector(dir, -size * 0.3);
        nrm.set(u.x + (rand() - 0.5) * 0.5, u.y + (rand() - 0.5) * 0.5, u.z + (rand() - 0.5) * 0.5);
        puff.copy(u).lerp(UP, 0.3).normalize();
        col.copy(b).offsetHSL((rand() - 0.5) * 0.045, 0, (rand() - 0.5) * 0.08).multiplyScalar((0.55 + rand() * 0.45) * (0.72 + 0.28 * (u.y * 0.5 + 0.5)));
        cards.add(p, dir, nrm, size, col, puff, 2, 2.2, rand);
      }
    }
  }
}
const ICO = new THREE.IcosahedronGeometry(1, 1), CONE = new THREE.ConeGeometry(1, 1, 9, 3);

// 場內四周（竹垣外的平台）的樹
function buildForest(rand, W, cards, core) {
  const placed = [];
  for (let i = 0; i < 46; i++) {
    const side = i % 3;
    let x, z, ok = false;
    for (let t = 0; t < 12 && !ok; t++) {
      x = side === 0 ? 16 + rand() * 12 : side === 1 ? -16 - rand() * 12 : -22 + rand() * 44;
      z = side === 2 ? 19 + rand() * 12 : -12 + rand() * 30;
      ok = placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > 2.6);
    }
    placed.push([x, z]);
    plantTree(rand, W, cards, core, x, 0, z);
  }
}

// ---------- 落葉 ----------
function fallenLeaves(scene, world, trees, map, rand) {
  // 可能接住落葉的東西：岩石、石頭與屋頂。其他地方直接用平面圖的地面高度
  scene.updateMatrixWorld(true);
  const overhead = new Set();
  OVERHEAD.forEach((o) => o.traverse((c) => overhead.add(c)));
  const targets = [];
  world.traverse((o) => {
    if (!o.isMesh || (o.material !== MATERIALS.rock && o.material !== MATERIALS.stone && o.material !== MATERIALS.roof)) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld);
    targets.push({ o, x: s.center.x, z: s.center.z, r: s.radius, roof: overhead.has(o) });
  });
  const ray = new THREE.Raycaster(new V3(), new V3(0, -1, 0), 0, 30);
  const sets = { ground: { m: [], c: [] }, roof: { m: [], c: [] } };
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), n = new V3(), pos = new V3(), sc = new V3(), m = new THREE.Matrix4();
  const col = new THREE.Color(), brown = new THREE.Color(0x6e4424), nm = new THREE.Matrix3();
  const Y = L.YUYA, P = L.PROPS;
  const nearProp = (x, z) => L.LANTERNS.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < 0.55)
    || [P.oke, P.shishi, P.milk].some((k) => Math.hypot(k.x - x, k.z - z) < 0.8);

  function drop(x, z, hue) {
    if (z < -12.4 || Math.abs(x) > 15.5 || z > 16) return;
    if (x > Y.x0 - 0.1 && x < Y.x1 + 0.1 && z > Y.z0 - 0.2) { if (z > 15.5) return; }
    if (nearProp(x, z)) return;
    let y = null, roof = false;
    n.set(0, 1, 0);
    const near = targets.filter((t) => Math.hypot(t.x - x, t.z - z) < t.r);
    if (near.length) {
      ray.ray.origin.set(x, 14, z);
      const hit = ray.intersectObjects(near.map((t) => t.o), false)[0];
      if (hit) {
        y = hit.point.y;
        n.copy(hit.face.normal).applyMatrix3(nm.getNormalMatrix(hit.object.matrixWorld)).normalize();
        if (n.y < 0.35) return; // 太陡，葉子留不住
        roof = overhead.has(hit.object);
      }
    }
    if (y === null && x > Y.x0 && x < Y.x1 && z > Y.z0) return; // 湯屋室內
    const water = L.poolT(x, z) < 1 && (y === null || y < L.POOL.waterY + 0.01);
    if (water) {
      if (rand() > 0.3) return;
      y = L.POOL.waterY + 0.004 + rand() * 0.002; n.set(0, 1, 0);
    } else if (y === null) {
      y = L.groundY(x, z);
      n.set((rand() - 0.5) * 0.16, 1, (rand() - 0.5) * 0.16).normalize();
    }
    const size = 0.085 + rand() * 0.055;
    q.setFromUnitVectors(UP, n).multiply(qy.setFromAxisAngle(UP, rand() * 6.283));
    pos.set(x, y + 0.007 + rand() * 0.012, z).addScaledVector(n, 0.004);
    m.compose(pos, q, sc.set(size, size, size));
    // 落葉比樹上的乾：偏褐、偏暗；水邊與水面的被打濕，顏色更深
    gradColor(hue + (rand() - 0.5) * 2.6, col).lerp(brown, rand() * rand() * 0.9).multiplyScalar(0.5 + rand() * 0.45);
    if (water || L.poolT(x, z) < 1.15) col.multiplyScalar(0.72);
    if (L.noLeaf(x, z)) return; // 足湯、躺椅上不撒（放在最後才判斷，前面的亂數順序不變）
    const s = roof ? sets.roof : sets.ground;
    s.m.push(...m.elements); s.c.push(col.r, col.g, col.b);
  }

  trees.forEach((t) => {
    const r = t.R.x, count = Math.round(r * r * 115);
    for (let i = 0; i < count; i++) {
      const d = r * 0.72 * Math.sqrt(-2 * Math.log(1 - rand() * 0.98)), a = rand() * 6.283;
      drop(t.C.x + Math.cos(a) * d, t.C.z + Math.sin(a) * d, t.hue);
    }
  });
  for (let i = 0; i < 2600; i++) drop(-14 + rand() * 28, -12.4 + rand() * 24, 1 + rand() * 3.5);

  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 });
  const make = (s) => {
    const mesh = new THREE.InstancedMesh(geo, mat, s.c.length / 3);
    mesh.instanceMatrix.array.set(s.m);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(s.c), 3);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const ground = make(sets.ground), roof = make(sets.roof);
  OVERHEAD.push(roof);
  return { ground, roof, material: mat };
}

// ---------- 組裝 ----------
export function createTrees(scene, world, slopeSpots = []) {
  const rand = rng(20261112);
  const atlas = atlasTexture(), leafMap = leafTexture();
  const bark = patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), 'BARK');
  const group = new THREE.Group();
  scene.add(group);

  // 楓樹
  const W = { trunk: newWood(), branch: newWood() };
  const maples = L.MAPLES.map((spec, i) => growMaple(spec, i, rand, W));
  const mapleCards = new Cards();
  maples.forEach((t) => leafMaple(t, Math.round(t.R.x * t.R.x * 400), mapleCards, rand));
  const lowCards = new Cards();
  const lowPos = lowBranch(maples[3], W, lowCards, rand);

  const trunks = woodMesh(W.trunk, bark), branches = woodMesh(W.branch, bark);
  const mapleFol = foliageMaterial(atlas), lowFol = foliageMaterial(atlas);
  const mapleLeaves = mapleCards.build(mapleFol), lowLeaves = lowCards.build(lowFol);
  group.add(trunks, branches, mapleLeaves, lowLeaves);
  OVERHEAD.push(branches, mapleLeaves, lowLeaves);

  // 場外樹林
  const FW = newWood(), forestCards = new Cards(), core = { pos: [], col: [] };
  buildForest(rand, FW, forestCards, core);

  // 崖下山坡上的樹（vista.js 挑好位置與高度上限）：遠一點的貼片少而大、不投影
  // 崖邊 40 公尺內的樹用完整細節（算進場外樹林那組，會投影）
  const SW = newWood(), slopeCards = new Cards(), sc = { pos: [], col: [] };
  const srand = rng(777); // 另用一組亂數，場內原本的落葉位置才不會跟著變
  slopeSpots.forEach(([x, y, z, maxH, near]) => {
    if (near) plantTree(srand, FW, forestCards, core, x, y, z, { maxH });
    else plantTree(srand, SW, slopeCards, sc, x, y, z, { lite: true, maxH });
  });
  const coreGeo = new THREE.BufferGeometry();
  coreGeo.setAttribute('position', new THREE.Float32BufferAttribute(core.pos, 3));
  coreGeo.setAttribute('color', new THREE.Float32BufferAttribute(core.col, 3));
  coreGeo.computeVertexNormals();
  const coreMesh = new THREE.Mesh(coreGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  coreMesh.castShadow = true;
  const forestLeaves = forestCards.build(foliageMaterial(atlas));
  group.add(woodMesh(FW, bark), coreMesh, forestLeaves);

  if (slopeSpots.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sc.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(sc.col, 3));
    g.computeVertexNormals();
    const slopeLeaves = slopeCards.build(foliageMaterial(atlas), false);
    slopeLeaves.receiveShadow = false;
    const slopeWood = woodMesh(SW, bark);
    slopeWood.castShadow = false;
    group.add(slopeWood, new THREE.Mesh(g, coreMesh.material), slopeLeaves);
  }

  const fallen = fallenLeaves(scene, world, maples, leafMap, rand);

  return {
    group, mapleLeaves, forestLeaves, fallen, leafMap, gradColor,
    maples: maples.map((t) => ({ center: t.C, radius: t.R, hue: t.hue })),
    // 4C「搖落紅葉」用：pos 是注視點，uShake 加大時這一枝會劇烈晃動
    low: { mesh: lowLeaves, pos: lowPos, uShake: lowFol.uShake, hue: maples[3].hue },
  };
}
