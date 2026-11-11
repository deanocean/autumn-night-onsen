// 程序化材質：不用貼圖，直接在 shader 裡依世界座標算出岩石、木紋、地面等表面。
// 做法是在 Three.js 標準材質上「打補丁」，光照與陰影仍沿用內建計算。
import { POOL } from './layout.js';
import { G } from './env.js';

export const GLSL_NOISE = /* glsl */ `
// 與 smoothstep 相同，但兩個邊界可以反過來寫（GLSL 內建版本在這種情況下行為未定義）
float rs(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float hash1(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash1(i), hash1(i + vec3(1,0,0)), f.x), mix(hash1(i + vec3(0,1,0)), hash1(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash1(i + vec3(0,0,1)), hash1(i + vec3(1,0,1)), f.x), mix(hash1(i + vec3(0,1,1)), hash1(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float fbm2(vec3 p){ return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + vec3(1.7, 9.2, 3.1)); }
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
// 回傳 (到最近點的距離, 到格線的距離, 該格的亂數)
vec3 voro(vec2 x){
  vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 r = g + hash2(n + g) - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash21(n + g); } else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}
`;

export const GLSL_POOL = /* glsl */ `
float poolRim(float th){ return 1.0 + 0.12 * sin(2.0 * th + 0.6) + 0.08 * sin(3.0 * th + 1.9) + 0.05 * sin(5.0 * th); }
float poolT(vec2 p){
  vec2 d = (p - vec2(${POOL.cx.toFixed(3)}, ${POOL.cz.toFixed(3)})) / vec2(${POOL.a.toFixed(3)}, ${POOL.b.toFixed(3)});
  return length(d) / poolRim(atan(d.y, d.x));
}
float poolDepth(vec2 p){
  float t = poolT(p);
  float floorY = -${POOL.depth.toFixed(3)} * rs(1.0, 0.78, t);
  return max(0.0, ${POOL.waterY.toFixed(3)} - floorY);
}
`;

// 每種表面提供兩個函式：surfH（凹凸高度，公尺）與 surfC（顏色倍率與粗糙度）
const MODES = {
  ROCK: /* glsl */ `
    // 裂隙：把雜訊折成尖銳的谷線
    float crease(vec3 p){ return 1.0 - abs(2.0 * fbm2(p) / 0.75 - 1.0); }
    float surfH(vec3 wp, vec3 op){
      float cr = pow(crease(wp * 1.7 + 3.0), 6.0);
      float pit = rs(0.55, 0.8, vnoise(wp * 26.0));
      return fbm(wp * 2.4) * 0.07 + fbm(wp * 9.0) * 0.03 + vnoise(wp * 55.0) * 0.005 - cr * 0.05 - pit * 0.008;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      float a = fbm(wp * 1.3);
      c = mix(vec3(0.12, 0.12, 0.13), vec3(0.42, 0.41, 0.39), a);
      c *= 0.7 + 0.6 * fbm2(wp * vec3(7.0, 1.6, 7.0));
      c *= 0.75 + 0.5 * vnoise(wp * 60.0);
      float cr = pow(crease(wp * 1.7 + 3.0), 6.0);
      c *= 1.0 - cr * 0.6;
      // 地衣：灰白與赭黃的斑塊
      float li = rs(0.6, 0.72, fbm(wp * 3.2 + 20.0)) * rs(0.1, 0.5, n.y + 0.4);
      c = mix(c, mix(vec3(0.62, 0.64, 0.58), vec3(0.66, 0.56, 0.30), vnoise(wp * 2.0 + 8.0)), li * 0.55);
      c = mix(c, vec3(0.62, 0.58, 0.50), rs(0.62, 0.8, vnoise(wp * 5.0 + 11.0)) * 0.35);
      float wet = rs(0.2, -0.06, wp.y + (a - 0.5) * 0.12);
      float moss = rs(0.35, 0.85, n.y) * rs(0.42, 0.6, fbm(wp * 1.6 + 7.0)) * (1.0 - wet);
      c = mix(c, vec3(0.22, 0.30, 0.09) * (0.7 + 0.6 * vnoise(wp * 24.0)), moss * 0.85);
      // 落在岩頂的紅葉
      vec3 v = voro(wp.xz * 9.0);
      float leaf = step(v.z, 0.16) * rs(0.3, 0.22, v.x) * rs(0.6, 0.9, n.y) * (1.0 - wet);
      c = mix(c, mix(vec3(0.62, 0.10, 0.04), vec3(0.85, 0.45, 0.08), fract(v.z * 37.0)), leaf);
      c *= mix(1.0, 0.45, wet);
      r = mix(0.93, 0.22, wet);
      r = mix(r, 1.0, moss);
    }`,
  GROUND: /* glsl */ `
    float leafMask(vec3 wp, float scale, float seed, out float id){
      vec3 v = voro(wp.xz * scale + seed);
      float dens = rs(0.3, 0.68, fbm2(wp * 0.33 + seed)) * 0.62 + 0.06;
      id = fract(v.z * 53.0 + seed);
      return step(v.z, dens) * rs(0.34, 0.26, v.x);
    }
    float surfH(vec3 wp, vec3 op){
      float id; float l = max(leafMask(wp, 8.0, 0.0, id), leafMask(wp, 11.0, 5.3, id));
      return vnoise(wp * 42.0) * 0.006 + fbm2(wp * 6.0) * 0.012 + l * 0.006;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      float a = fbm(wp * 2.2);
      c = mix(vec3(0.21, 0.18, 0.14), vec3(0.40, 0.36, 0.29), a);
      c *= 0.8 + 0.4 * vnoise(wp * 46.0);
      float moss = rs(0.46, 0.66, fbm(wp * 0.55 + 3.0));
      c = mix(c, vec3(0.20, 0.27, 0.10) * (0.75 + 0.5 * vnoise(wp * 30.0)), moss * 0.75);
      float t = poolT(wp.xz);
      float wet = rs(1.22, 1.02, t + (a - 0.5) * 0.1);
      c = mix(c, vec3(0.30, 0.30, 0.31) * (0.7 + 0.5 * a), wet * 0.8);
      float id1, id2;
      float l1 = leafMask(wp, 8.0, 0.0, id1), l2 = leafMask(wp, 11.0, 5.3, id2);
      vec3 lc1 = mix(vec3(0.58, 0.08, 0.03), vec3(0.86, 0.40, 0.06), id1);
      vec3 lc2 = mix(vec3(0.70, 0.22, 0.04), vec3(0.88, 0.62, 0.12), id2);
      c = mix(c, lc1 * (0.7 + 0.5 * id2), l1);
      c = mix(c, lc2, l2);
      c *= mix(1.0, 0.6, wet);
      r = mix(0.97, 0.35, wet * (1.0 - max(l1, l2)));
    }`,
  BASIN: /* glsl */ `
    float surfH(vec3 wp, vec3 op){
      vec3 v = voro(wp.xz * 1.25);
      return rs(0.0, 0.06, v.y) * 0.02 + fbm2(wp * 9.0) * 0.006;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec3 v = voro(wp.xz * 1.25);
      c = mix(vec3(0.46, 0.50, 0.47), vec3(0.74, 0.76, 0.70), v.z);
      c *= 0.82 + 0.3 * fbm2(wp * 5.0);
      c *= mix(0.4, 1.0, rs(0.0, 0.05, v.y));
      // 水底搖晃的光網
      vec2 q = wp.xz * 2.6 + vec2(vnoise(vec3(wp.xz * 1.3, uTime * 0.25)), vnoise(vec3(wp.zx * 1.3 + 5.0, uTime * 0.25))) * 1.6;
      float ca = voro(q + uTime * 0.12).y;
      c *= 1.0 + pow(1.0 - rs(0.0, 0.22, ca), 3.0) * 0.55 * uCaustic;
      r = 0.55;
    }`,
  STONE: /* glsl */ `
    float surfH(vec3 wp, vec3 op){ return fbm(wp * 16.0) * 0.008 + vnoise(wp * 70.0) * 0.002; }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      c = vec3(0.72 + 0.22 * fbm(wp * 5.0));
      c *= 0.8 + 0.35 * vnoise(wp * 80.0);
      c = mix(c, c * vec3(0.55, 0.52, 0.48), rs(0.5, 0.75, fbm(wp * 2.0 + 4.0)));
      float moss = rs(0.5, 0.7, fbm(wp * 3.0 + 9.0)) * rs(-0.2, 0.7, n.y) * 0.6;
      c = mix(c, vec3(0.30, 0.38, 0.14), moss);
      r = 0.9;
    }`,
  WOOD: /* glsl */ `
    vec3 grainP(vec3 op){
      #if GRAIN == 0
        return op.xyz;
      #elif GRAIN == 1
        return op.yxz;
      #else
        return op.zyx;
      #endif
    }
    float plankSeam(vec3 q, out float id){
      #ifdef PLANK
        #ifdef PLANKY
          float u = q.y / PLANK + 0.5;
        #else
          float u = q.z / PLANK + 0.5;
        #endif
        id = hash21(vec2(floor(u), vSeed));
        return 1.0 - rs(0.004, 0.012, (0.5 - abs(fract(u) - 0.5)) * PLANK);
      #else
        id = 0.5; return 0.0;
      #endif
    }
    float grainN(vec3 q, float id){
      vec3 g = vec3(q.x * 0.7 + id * 17.0, q.y * 26.0, q.z * 26.0) + vSeed;
      return fbm(g);
    }
    // 木節：沿木紋拉長的同心圓
    float knot(vec3 q, float id){
      vec2 k = vec2(q.x * 0.9 + id * 9.0 + vSeed, (q.y + q.z) * 5.0 + id * 3.0);
      vec3 v = voro(k);
      return step(v.z, 0.16) * (1.0 - rs(0.0, 0.3, v.x));
    }
    float surfH(vec3 wp, vec3 op){
      vec3 q = grainP(op); float id; float s = plankSeam(q, id);
      float g = grainN(q, id);
      float ring = sin((q.y * 0.6 + q.z) * 90.0 + g * 14.0 + id * 40.0);
      // 風化後軟的春材被磨掉，留下一條條凸起的硬紋
      return g * 0.012 + ring * 0.0022 + knot(q, id) * 0.004 - s * 0.012;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec3 q = grainP(op); float id; float s = plankSeam(q, id);
      // 遠處木紋細過一個像素時淡出，避免閃爍
      float aa = clamp(1.0 - (fwidth(q.y) + fwidth(q.z)) * 26.0, 0.0, 1.0);
      float g = mix(0.5, grainN(q, id), aa);
      float ring = mix(0.5, sin((q.y * 0.6 + q.z) * 90.0 + g * 14.0 + id * 40.0) * 0.5 + 0.5, aa * aa);
      float kn = knot(q, id) * aa;
      c = vec3(0.52 + 0.85 * g) * (0.8 + 0.3 * ring) * (0.8 + 0.4 * id);
      c *= vec3(1.0, 0.97 - 0.1 * g, 0.92 - 0.16 * g);
      c *= 1.0 - kn * 0.55;
      // 風化：偏灰、近地處較深
      float weather = fbm2(wp * 1.7 + 2.0);
      c = mix(c, vec3(dot(c, vec3(0.333))) * vec3(0.92, 0.95, 1.0), weather * WEATHER);
      c *= mix(0.7, 1.0, rs(0.0, 0.5, wp.y + weather * 0.3));
      c *= 1.0 - s * 0.75;
      r = 0.78 - 0.12 * ring;
    }`,
  ROOF: /* glsl */ `
    // 杮葺：薄木片一排排疊上去。op.z 沿屋面斜向，op.x 沿屋脊方向
    vec3 shingle(vec3 op){
      float row = op.z / 0.2; float fr = fract(row); float ri = floor(row);
      float col = op.x / 0.13 + hash21(vec2(ri, 3.0)) ; float fc = fract(col);
      float id = hash21(vec2(floor(col), ri));
      return vec3(fr, fc, id);
    }
    float surfH(vec3 wp, vec3 op){
      vec3 s = shingle(op);
      return s.x * 0.012 + s.z * 0.004 - (1.0 - rs(0.0, 0.08, min(s.y, 1.0 - s.y))) * 0.006;
    }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec3 s = shingle(op);
      c = mix(vec3(0.20, 0.17, 0.15), vec3(0.36, 0.31, 0.26), s.z);
      c *= 0.62 + 0.5 * s.x;
      c *= 0.5 + 0.5 * rs(0.0, 0.1, min(s.y, 1.0 - s.y));
      float moss = rs(0.5, 0.7, fbm(wp * 0.9 + 1.0));
      c = mix(c, vec3(0.19, 0.24, 0.10), moss * 0.6);
      vec3 v = voro(wp.xz * 7.0 + 2.0);
      float leaf = step(v.z, 0.22) * rs(0.3, 0.22, v.x) * step(0.0, n.y);
      c = mix(c, mix(vec3(0.60, 0.10, 0.04), vec3(0.85, 0.48, 0.08), fract(v.z * 31.0)), leaf);
      r = 0.95;
    }`,
  PLASTER: /* glsl */ `
    float surfH(vec3 wp, vec3 op){ return fbm(wp * 9.0) * 0.004; }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      c = vec3(0.9 + 0.12 * fbm(wp * 3.0));
      c *= mix(0.86, 1.0, rs(0.3, 0.7, fbm2(wp * vec3(0.9, 0.3, 0.9) + 5.0)));
      r = 0.95;
    }`,
  BAMBOO: /* glsl */ `
    // 竹穗垣：細竹直排，上下以橫竹押住
    vec2 cane(vec3 wp){
      float u = (wp.x + wp.z) / 0.045; float id = hash21(vec2(floor(u), 7.0));
      float f = fract(u) * 2.0 - 1.0;
      return vec2(sqrt(max(0.0, 1.0 - f * f)), id);
    }
    float rail(vec3 wp){ float y = wp.y; return max(max(rs(0.05, 0.03, abs(y - 0.35)), rs(0.05, 0.03, abs(y - 1.05))), rs(0.05, 0.03, abs(y - 1.7))); }
    float surfH(vec3 wp, vec3 op){ return mix(cane(wp).x * 0.016, 0.03, rail(wp)); }
    void surfC(vec3 wp, vec3 op, vec3 n, out vec3 c, out float r){
      vec2 k = cane(wp); float rl = rail(wp);
      c = mix(vec3(0.42, 0.33, 0.19), vec3(0.66, 0.55, 0.33), k.y);
      float node = rs(0.012, 0.0, abs(fract(wp.y / 0.42 + k.y) - 0.5) * 0.42);
      c *= (0.45 + 0.55 * k.x) * (1.0 - node * 0.35);
      c *= 0.8 + 0.3 * fbm2(wp * 1.5);
      c = mix(c, vec3(0.50, 0.42, 0.24) * (0.8 + 0.3 * vnoise(wp * vec3(3.0, 60.0, 3.0))), rl);
      c *= mix(0.72, 1.0, rs(0.0, 0.6, wp.y));
      r = 0.7;
    }`,
};

const BUMP_FN = /* glsl */ `
vec3 sBump(vec3 p, vec3 n, vec2 dH, float fd){
  vec3 sx = dFdx(p), sy = dFdy(p);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * n - grad);
}
`;

// 把表面函式注入標準材質
export function patch(material, mode, defines = {}) {
  const defs = { GRAIN: 0, WEATHER: '0.45', ...defines };
  const defStr = Object.entries(defs).map(([k, v]) => `#define ${k} ${v}`).join('\n');
  material.customProgramCacheKey = () => mode + defStr;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.uniforms.uCaustic = G.caustic;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vOPos; varying vec3 vWN; varying float vSeed;`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vWN = normalize(mat3(modelMatrix) * objectNormal);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vOPos = transformed;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSeed = dot(modelMatrix[3].xyz, vec3(1.31, 2.17, 3.73));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${defStr}
        varying vec3 vWPos; varying vec3 vOPos; varying vec3 vWN; varying float vSeed;
        uniform float uTime; uniform float uCaustic;
        ${GLSL_NOISE}
        ${GLSL_POOL}
        ${MODES[mode]}
        ${BUMP_FN}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sC; float sR;
        surfC(vWPos, vOPos, normalize(vWN), sC, sR);
        diffuseColor.rgb *= sC;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = sR;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float bFade = 1.0 - rs(10.0, 34.0, length(vViewPosition));
          if (bFade > 0.0) {
            vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos), dox = dFdx(vOPos), doy = dFdy(vOPos);
            float h0 = surfH(vWPos, vOPos);
            float hx = surfH(vWPos + dpx, vOPos + dox);
            float hy = surfH(vWPos + dpy, vOPos + doy);
            normal = sBump(-vViewPosition, normal, vec2(hx - h0, hy - h0) * bFade, faceDirection);
          }
        }`);
  };
  return material;
}
