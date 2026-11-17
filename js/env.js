// 全場共用的環境狀態：時間、太陽方向與光色。
// 各個 shader 直接引用這些 uniform 物件，第三階段的日夜切換只要改這裡的值。
import * as THREE from 'three';

// 交給水面、蒸氣、樹葉 shader 的燈具位置有幾格（GLSL 陣列長度要寫死；燈超過這個數就要調大）
export const LAMP_N = 20;

export const G = {
  uTime: { value: 0 },
  sunDir: { value: new THREE.Vector3(-0.5, 0.72, 0.48).normalize() },
  sunCol: { value: new THREE.Color(1.0, 0.9, 0.74) },
  // 水體與蒸氣受到的整體環境光（白天偏亮、夜晚偏暗）
  ambient: { value: new THREE.Color(0.92, 0.95, 1.0) },
  caustic: { value: 1 }, // 水底光網的強度（夜晚關掉）
  steamCol: { value: new THREE.Color(1, 1, 1) },
  steamDensity: { value: 1 },
  sunSpec: { value: 1 },    // 水面太陽高光的強度
  night: { value: 0 },      // 0 = 白天，0.5 = 黃昏，1 = 夜晚
  dusk: { value: 0 },       // 黃昏的程度（只在 night 0.5 附近不為 0），天空的晚霞用
  starBoost: { value: 1 },  // 熄燈後星空變亮的倍率（interact.js 驅動）
  steamBoost: { value: 1 }, // 泡湯時蒸氣變濃的倍率
  house: { value: 1 },      // 湯屋窗內的燈光（燈全熄時跟著暗下來）
  // 燈具：xyz 為位置，w 為亮度；水面與蒸氣用它算出被燈光染亮的程度
  lampPos: { value: Array.from({ length: LAMP_N }, () => new THREE.Vector4(0, -99, 0, 0)) },
  lampCol: { value: new THREE.Color(1.0, 0.62, 0.3) },
  skyTop: { value: new THREE.Color(0x4f86c6) },
  skyHorizon: { value: new THREE.Color(0xd4dde6) },
};
