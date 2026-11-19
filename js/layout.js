// 場景的「平面圖」：所有尺寸、位置、碰撞與地面高度都定義在這裡。
// 材質、水、植栽、互動等各檔都讀這份資料，配置只需要改這一處。
// 座標：x 向東、z 向南、y 向上；單位公尺。北側（-z）是崖邊，俯瞰海灣。

export const POOL = { cx: 0, cz: -1, a: 7.0, b: 4.6, depth: 0.75, waterY: -0.12 };

// 不規則池岸：橢圓半徑乘上一個隨角度變化的係數
export function poolRim(theta) {
  return 1 + 0.12 * Math.sin(2 * theta + 0.6) + 0.08 * Math.sin(3 * theta + 1.9) + 0.05 * Math.sin(5 * theta);
}

// 0 = 池心，1 = 池岸，>1 = 岸上
export function poolT(x, z) {
  const dx = (x - POOL.cx) / POOL.a;
  const dz = (z - POOL.cz) / POOL.b;
  return Math.hypot(dx, dz) / poolRim(Math.atan2(dz, dx));
}

export function poolPoint(theta, t = 1) {
  const r = poolRim(theta) * t;
  return [POOL.cx + Math.cos(theta) * POOL.a * r, POOL.cz + Math.sin(theta) * POOL.b * r];
}

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const ENGAWA = { x0: -11, x1: 3, z0: 9, z1: 11, y: 0.45 };
export const DECK = { x0: -4.5, x1: 4.5, z0: -12.5, z1: -8.5, y: 0.25 };
export const BOUNDS = { x0: -13.8, x1: 13.8, z0: -12.1, z1: 10.6 };
export const YUYA = { x0: -11.5, x1: 3.5, z0: 11, z1: 16, h: 3.4 };
export const AZUMAYA = { x0: -9.2, x1: -4.4, z0: -3.6, z1: 1.6, eave: 2.5, ridge: 3.7 };

// 足湯：望景木台北緣的檜木槽。由南往北依序是坐板（seatZ1 → seatZ0）、水槽（→ tubZ0）、外側的矮欄（railZ）。
// 高度都是相對木台面：h 槽緣與坐板、waterY 水面、floorY 槽底、railH 矮欄頂
export const ASHIYU = {
  x0: -2.5, x1: 2.5, seatZ1: -11.0, seatZ0: -11.5, tubZ0: -12.2, railZ: -12.5,
  h: 0.4, waterY: 0.31, floorY: 0.06, wall: 0.06, railH: 0.56,
  spoutX: 2.5, // 注水的竹筒在東端
};
ASHIYU.spout = { x: ASHIYU.x1 - 0.24, y: DECK.y + 0.6, z: (ASHIYU.tubZ0 + ASHIYU.seatZ0) / 2 }; // 竹筒出水口
// 西翼：一小塊低木台，上面一張躺椅（頭朝南、腳朝海灣）與小几
export const LOUNGE = {
  x0: -10.4, x1: -7.6, z0: -11.9, z1: -8.9, y: 0.12,
  chair: { x: -9.25, z: -10.35, rot: -0.14 }, // rot：繞 y 軸；0 時腳朝正北
  table: { x: -8.3, z: -10.0 },
  parasol: { x: -7.8, z: -9.1, r: 0.92 }, // 野点傘：立在躺椅的右後方，不擋仰望的視野
};
// 東翼：壺湯。圓形淺水池（r 是水面半徑，外面一圈 rimW 寬、rimH 高的花崗石緣；floorY 池底、waterY 淺池水面），
// 中央一顆陶壺（pot：r 外徑的一半、h 壺高、inner 壺口內半徑、waterY 壺裡的水面，高度都是離地）。
export const TSUBO = {
  x: 9.6, z: -9.6, r: 2.0, rimW: 0.24, rimH: 0.15, floorY: 0.03, waterY: 0.075,
  pot: { r: 0.76, h: 0.75, inner: 0.69, waterY: 0.771, seatY: 0.2 },
};
// 陶壺外側的輪廓（[半徑, 高度]，高度從壺底算起）：底窄、腹鼓、口緣外翻。world.js 的壺身與 water.js 的溢流水膜共用
export function potProfile(grow = 0) {
  const P = TSUBO.pot, pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push([0.6 + 0.16 * Math.pow(Math.sin(t * Math.PI * 0.62), 0.9) + grow, t * (P.h - 0.05)]);
  }
  pts.push([P.r + 0.012 + grow, P.h - 0.04], [P.r + 0.02 + grow, P.h - 0.018], [P.r + 0.008 + grow, P.h], [P.inner + 0.03, P.h + 0.004]);
  return pts;
}
// 進壺湯的方向（從主池東側的飛石走來，西南偏南）與沿路的六角踏石：[x, z, 半徑, 高度]
const TSUBO_IN = { x: -0.41, z: 0.91 };
TSUBO.steps = [[1.14, 0.34, 0.3], [1.72, 0.3, 0.13]].map(([d, r, h]) => [TSUBO.x + TSUBO_IN.x * d, TSUBO.z + TSUBO_IN.z * d, r, h]);
// 竹筒湯口：立在壺的正東，竹管伸到壺口上方（tip 是出水口）
TSUBO.spout = { postX: TSUBO.x + TSUBO.pot.r + 0.2, postH: 1.22, tip: { x: TSUBO.x + 0.5, y: 1.0, z: TSUBO.z } };
// 0 = 不在壺湯，1 = 石緣上，2 = 淺池裡
export function tsuboAt(x, z) {
  const d = Math.hypot(x - TSUBO.x, z - TSUBO.z);
  return d < TSUBO.r ? 2 : d < TSUBO.r + TSUBO.rimW ? 1 : 0;
}
// 崖邊欄杆：木台兩側到東西竹垣（z 與木台正面的欄杆同一條線）
export const CLIFF_RAILS = [{ x0: -14.2, x1: DECK.x0 }, { x0: DECK.x1, x1: 14.2 }];

// 腳下的地面高度
export function groundY(x, z) {
  if (x > ENGAWA.x0 && x < ENGAWA.x1 && z > ENGAWA.z0 - 0.1) return ENGAWA.y;
  if (x > ENGAWA.x0 + 3 && x < ENGAWA.x0 + 7 && z > ENGAWA.z0 - 0.75) return ENGAWA.y * 0.5; // 沓脫石
  if (x > DECK.x0 && x < DECK.x1 && z < DECK.z1) return DECK.y;
  if (x > LOUNGE.x0 && x < LOUNGE.x1 && z > LOUNGE.z0 && z < LOUNGE.z1) return LOUNGE.y;
  const ts = tsuboAt(x, z);
  if (ts === 1) return TSUBO.rimH;
  if (ts === 2) {
    for (const [sx, sz, r, h] of TSUBO.steps) if (Math.hypot(x - sx, z - sz) < r) return TSUBO.floorY + h;
    return TSUBO.floorY;
  }
  const t = poolT(x, z);
  if (t < 1) return -POOL.depth * smooth(1, 0.78, t);
  return 0;
}

export function inWater(x, z) {
  return groundY(x, z) < POOL.waterY - 0.05;
}

// 碰撞體：圓（岩石、柱、樹幹、燈籠）與軸對齊矩形（牆、欄杆、竹垣）
export const circles = [];
export const boxes = [];

// 池中大岩
export const CENTER_ROCK = { x: 1.6, z: -0.6, r: 1.25, h: 1.1 };
circles.push({ x: CENTER_ROCK.x, z: CENTER_ROCK.z, r: CENTER_ROCK.r });

// 池岸岩石：[角度, 向外偏移, 半徑, 高度]。西南（小徑入口）、西（東屋）、北（望景台）留出缺口。
const rimSpec = [
  [-0.55, 0.06, 0.95, 0.9], [-0.25, 0.1, 1.2, 1.3], [0.05, 0.12, 1.35, 1.6], [0.32, 0.1, 1.05, 1.1],
  [0.6, 0.07, 0.8, 0.7], [0.92, 0.06, 0.9, 0.85], [1.25, 0.05, 0.7, 0.55],
  [1.62, 0.05, 0.75, 0.6], [1.95, 0.05, 0.6, 0.5],
  [-0.9, 0.05, 0.7, 0.6], [-2.15, 0.05, 0.75, 0.65], [-2.5, 0.06, 0.9, 0.8],
  [2.95, 0.05, 0.55, 0.45],
];
export const RIM_ROCKS = rimSpec.map(([th, off, r, h]) => {
  const [x, z] = poolPoint(th, 1 + off);
  return { x, z, r, h };
});
RIM_ROCKS.forEach((k) => circles.push({ x: k.x, z: k.z, r: k.r * 0.9 }));

// 湯口：東側岩堆中伸出的竹筒
export const YUGUCHI = (() => {
  const [x, z] = poolPoint(0.05, 0.9);
  return { x, z, y: 0.85 };
})();

// 東屋柱（東側兩根立在水裡）
export const AZUMAYA_POSTS = [
  [AZUMAYA.x0 + 0.4, AZUMAYA.z0 + 0.4], [AZUMAYA.x0 + 0.4, AZUMAYA.z1 - 0.4],
  [AZUMAYA.x1 - 0.4, AZUMAYA.z0 + 0.4], [AZUMAYA.x1 - 0.4, AZUMAYA.z1 - 0.4],
];
AZUMAYA_POSTS.forEach(([x, z]) => circles.push({ x, z, r: 0.14 }));

// 湯屋牆、簷廊柱
boxes.push({ x0: YUYA.x0, x1: YUYA.x1, z0: YUYA.z0 - 0.15, z1: YUYA.z1 });
// 入口（x = -4.94）兩旁的兩根對稱，上面架著唐破風
export const ENGAWA_POSTS = [-10.6, -6.74, -3.14, 0.2, 2.6].map((x) => [x, ENGAWA.z0 + 0.25]);
ENGAWA_POSTS.forEach(([x, z]) => circles.push({ x, z, r: 0.12 }));

// 望景台欄杆與足湯；崖邊欄杆
boxes.push({ x0: DECK.x0, x1: DECK.x1, z0: DECK.z0 - 0.1, z1: DECK.z0 + 0.1 });
boxes.push({ x0: DECK.x0 - 0.1, x1: DECK.x0 + 0.1, z0: DECK.z0, z1: DECK.z1 - 1.2 });
boxes.push({ x0: DECK.x1 - 0.1, x1: DECK.x1 + 0.1, z0: DECK.z0, z1: DECK.z1 - 1.2 });
boxes.push({ x0: ASHIYU.x0 - ASHIYU.wall, x1: ASHIYU.x1 + ASHIYU.wall, z0: ASHIYU.tubZ0 - ASHIYU.wall, z1: ASHIYU.seatZ1 });
CLIFF_RAILS.forEach((r) => boxes.push({ x0: r.x0, x1: r.x1, z0: DECK.z0 - 0.1, z1: DECK.z0 + 0.1 }));

// 躺椅（沿椅身排三個圓）與小几
for (const s of [-0.6, 0, 0.6]) {
  const c = LOUNGE.chair;
  circles.push({ x: c.x - Math.sin(c.rot) * s, z: c.z + Math.cos(c.rot) * s, r: 0.36 });
}
circles.push({ x: LOUNGE.table.x, z: LOUNGE.table.z, r: 0.24 });
circles.push({ x: LOUNGE.parasol.x, z: LOUNGE.parasol.z, r: 0.14 });

// 壺與竹筒湯口
circles.push({ x: TSUBO.x, z: TSUBO.z, r: TSUBO.pot.r });
circles.push({ x: TSUBO.spout.postX, z: TSUBO.z, r: 0.07 });

// 不撒落葉的範圍（足湯、躺椅與小几、壺湯）
export function noLeaf(x, z) {
  if (Math.hypot(x - TSUBO.x, z - TSUBO.z) < TSUBO.r + TSUBO.rimW + 0.04) return true;
  if (x > ASHIYU.x0 - 0.1 && x < ASHIYU.x1 + 0.1 && z > ASHIYU.tubZ0 - 0.1 && z < ASHIYU.seatZ1 + 0.03) return true;
  const c = LOUNGE.chair, dx = x - c.x, dz = z - c.z;
  const u = dx * Math.cos(c.rot) + dz * Math.sin(c.rot), v = -dx * Math.sin(c.rot) + dz * Math.cos(c.rot);
  if (Math.abs(u) < 0.4 && Math.abs(v) < 1.05) return true;
  if (Math.hypot(x - LOUNGE.parasol.x, z - LOUNGE.parasol.z) < 0.22) return true;
  return Math.hypot(x - LOUNGE.table.x, z - LOUNGE.table.z) < 0.3;
}

// 竹垣（東、西兩側；北側不設，視野敞開）
export const FENCES = [
  { x0: 14.2, x1: 14.4, z0: -12.5, z1: 16 },
  { x0: -14.4, x1: -14.2, z0: -12.5, z1: 16 },
  { x0: 3.5, x1: 14.4, z0: 11.4, z1: 11.6 },
  { x0: -14.4, x1: -11.5, z0: 11.4, z1: 11.6 },
];
FENCES.forEach((f) => boxes.push(f));

// 楓樹（場內，枝葉伸到池面與小徑上方）：[x, z, 樹高, 樹冠半徑]
export const MAPLES = [
  [9.6, 4.6, 6.5, 3.6], [11.4, -4.2, 7.5, 4.0], [-11.6, -7.2, 7.0, 3.8],
  [-2.2, 6.4, 5.5, 3.0], [6.2, -8.0, 6.0, 3.2], [-12.2, 3.6, 6.5, 3.4], [5.4, 8.6, 6.0, 3.2],
];
MAPLES.forEach(([x, z]) => circles.push({ x, z, r: 0.28 }));

// 場外樹林（竹垣外的平台）：[x, z, 種類]，s = 杉、b = 闊葉樹（原本是亂數撒的，6E-1 起固定下來）
export const FOREST = [
  [27.33, 0.34, 'b'], [-16.08, 10.78, 'b'], [-16.86, 20, 's'], [24.95, 2.07, 'b'], [-20.54, -4.32, 'b'], [-7.92, 28.12, 'b'],
  [24.58, -2.7, 's'], [-21.13, -7.87, 'b'], [-2.28, 22.13, 'b'], [20.85, 2.03, 'b'], [-26.74, 0.91, 'b'], [17.34, 27.05, 'b'],
  [27.76, -5.6, 's'], [-23.7, 8.92, 's'], [20.24, 23.67, 'b'], [20.93, 8.83, 's'], [-23.63, -3.01, 'b'], [12.73, 30.12, 's'],
  [27.41, 8.21, 'b'], [-23.76, -10.64, 's'], [-2.84, 19.32, 's'], [17.8, 2.47, 'b'], [-18.52, 15.94, 's'], [-2.23, 30.97, 'b'],
  [18.22, -1.62, 'b'], [-27.53, 17.51, 's'], [-5.73, 21.06, 'b'], [18.76, 16.59, 'b'], [-17.93, -1.46, 's'], [3.06, 22.48, 's'],
  [24.04, 10.78, 's'], [-21.96, 2.74, 'b'], [-21.03, 26.13, 's'], [23.37, -7.62, 's'], [-17.62, -9.57, 'b'], [14.45, 28.11, 'b'],
  [27.63, 12.93, 's'], [-24.93, 12.71, 'b'], [-16.02, 29.26, 'b'], [16.41, -9.67, 'b'], [-19.31, 1.87, 's'], [-21.71, 23.35, 's'],
  [23.4, -11.69, 's'], [-27.2, -7.91, 'b'], [2.52, 30.31, 's'], [20.46, 12.74, 's'],
];

// 石燈籠與行燈：[x, z, 種類]
export const LANTERNS = [
  [-7.6, 7.2, 'stone'], [-8.4, 3.9, 'stone'], [3.6, 5.4, 'stone'], [9.2, -6.2, 'stone'],
  [-10.6, -1.0, 'stone'], [-3.9, -8.9, 'andon'], [3.9, -8.9, 'andon'],
  [-9.4, 9.5, 'andon'], [1.6, 9.5, 'andon'],
  [11.35, -7.85, 'andon'], // 壺湯旁
  [-10.05, -9.25, 'ashimoto'], // 躺椅頭側後方的足元灯（鐵笠遮住上方，光只往下灑）
];
LANTERNS.forEach(([x, z, kind]) => circles.push({ x, z, r: kind === 'stone' ? 0.32 : kind === 'andon' ? 0.2 : 0.12 }));

// 飛石小徑：從沓脫石到池的西南入口
export const PATH_STONES = [
  [-6.0, 7.7, 0.48], [-5.6, 6.8, 0.42], [-5.9, 5.9, 0.5], [-5.4, 5.0, 0.44], [-5.0, 4.1, 0.5],
  [-4.3, 3.4, 0.46],
  // 往望景台的分支，沿池的東南側繞行
  [-3.0, 4.6, 0.42], [-1.6, 5.0, 0.46], [0.2, 4.9, 0.44], [1.9, 5.3, 0.48],
  // 往東屋
  [-6.9, 4.6, 0.42], [-7.8, 3.2, 0.46], [-8.6, 2.2, 0.44],
  // 從主池東側往壺湯
  [7.3, -4.5, 0.46], [7.75, -5.45, 0.42], [8.0, -6.35, 0.48], [8.45, -7.15, 0.44],
];

// 小物位置（模型在 props.js；rot 是繞 y 軸的朝向）
export const PROPS = {
  oke: { x: -7.9, z: -1.2 },                      // 檜木桶，東屋下池邊
  stool: { x: -8.35, z: -1.0, rot: 0.5 },         // 小凳與手巾
  shishi: { x: -10.9, z: 6.4, rot: Math.PI / 2 }, // 鹿威し（rot 0 時竹筒口朝 +x）
  milk: { x: -1.2, z: 10.4, rot: 0 },             // 簷廊上的牛奶木箱
  mapleBranch: { x: -2.2, z: 5.2 },               // 可搖落紅葉的低枝
};
circles.push({ x: PROPS.shishi.x, z: PROPS.shishi.z, r: 0.7 });
circles.push({ x: PROPS.stool.x, z: PROPS.stool.z, r: 0.22 });
circles.push({ x: PROPS.milk.x, z: PROPS.milk.z, r: 0.3 });

export const START = { x: -5.2, z: 10.1, yaw: 0.12 };

export const LABELS = [
  ['湯屋簷廊（起點）', -7.5, 2.4, 9.6],
  ['入口・唐破風', -4.94, 4.6, 8.2],
  ['石板小徑', -5.6, 1.6, 6],
  ['半露天區', -6.8, 4.3, -1],
  ['主池', 0.5, 2.4, -2.6],
  ['池中大岩', CENTER_ROCK.x, 1.9, CENTER_ROCK.z],
  ['湯口', YUGUCHI.x + 0.6, 2.6, YUGUCHI.z],
  ['望景木台・足湯', 0, 2.4, -10.8],
  ['躺椅', LOUNGE.chair.x, 1.9, LOUNGE.chair.z],
  ['壺湯', TSUBO.x, 1.9, TSUBO.z],
  ['海灣・遠山（敞開面）', 0, 5.5, -26],
  ['鹿威し', PROPS.shishi.x, 1.6, PROPS.shishi.z],
  ['木桶', PROPS.oke.x, 1.2, PROPS.oke.z],
  ['牛奶', PROPS.milk.x, 1.7, PROPS.milk.z],
];
