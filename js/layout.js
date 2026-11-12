// 場景的「平面圖」：所有尺寸、位置、碰撞與地面高度都定義在這裡。
// 之後各階段（材質、水、植栽、互動）都讀這份資料，配置只需要改這一處。
// 座標：x 向東、z 向南、y 向上；單位公尺。北側（-z）朝山谷敞開。

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

// 腳下的地面高度
export function groundY(x, z) {
  if (x > ENGAWA.x0 && x < ENGAWA.x1 && z > ENGAWA.z0 - 0.1) return ENGAWA.y;
  if (x > ENGAWA.x0 + 3 && x < ENGAWA.x0 + 7 && z > ENGAWA.z0 - 0.75) return ENGAWA.y * 0.5; // 沓脫石
  if (x > DECK.x0 && x < DECK.x1 && z < DECK.z1) return DECK.y;
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
export const ENGAWA_POSTS = [-10.6, -7, -3.4, 0.2, 2.6].map((x) => [x, ENGAWA.z0 + 0.25]);
ENGAWA_POSTS.forEach(([x, z]) => circles.push({ x, z, r: 0.12 }));

// 望景台欄杆與長椅
boxes.push({ x0: DECK.x0, x1: DECK.x1, z0: DECK.z0 - 0.1, z1: DECK.z0 + 0.1 });
boxes.push({ x0: DECK.x0 - 0.1, x1: DECK.x0 + 0.1, z0: DECK.z0, z1: DECK.z1 - 1.2 });
boxes.push({ x0: DECK.x1 - 0.1, x1: DECK.x1 + 0.1, z0: DECK.z0, z1: DECK.z1 - 1.2 });
export const BENCH = { x: 0, z: -10.2, w: 2.4, d: 0.5, h: 0.42 };
boxes.push({ x0: BENCH.x - BENCH.w / 2, x1: BENCH.x + BENCH.w / 2, z0: BENCH.z - BENCH.d / 2, z1: BENCH.z + BENCH.d / 2 });

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

// 石燈籠與行燈：[x, z, 種類]
export const LANTERNS = [
  [-7.6, 7.2, 'stone'], [-8.4, 3.9, 'stone'], [3.6, 5.4, 'stone'], [9.2, -6.2, 'stone'],
  [-10.6, -1.0, 'stone'], [-3.9, -8.9, 'andon'], [3.9, -8.9, 'andon'],
  [-9.4, 9.5, 'andon'], [1.6, 9.5, 'andon'],
];
LANTERNS.forEach(([x, z, kind]) => circles.push({ x, z, r: kind === 'stone' ? 0.32 : 0.2 }));

// 飛石小徑：從沓脫石到池的西南入口
export const PATH_STONES = [
  [-6.0, 7.7, 0.48], [-5.6, 6.8, 0.42], [-5.9, 5.9, 0.5], [-5.4, 5.0, 0.44], [-5.0, 4.1, 0.5],
  [-4.3, 3.4, 0.46],
  // 往望景台的分支，沿池的東南側繞行
  [-3.0, 4.6, 0.42], [-1.6, 5.0, 0.46], [0.2, 4.9, 0.44], [1.9, 5.3, 0.48],
  // 往東屋
  [-6.9, 4.6, 0.42], [-7.8, 3.2, 0.46], [-8.6, 2.2, 0.44],
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

// 區域名稱（顯示目前所在位置）
export function zoneAt(x, z) {
  if (x > ENGAWA.x0 && x < ENGAWA.x1 && z > ENGAWA.z0 - 0.1) return '湯屋簷廊';
  if (x > DECK.x0 && x < DECK.x1 && z < DECK.z1) return '望景木台';
  if (inWater(x, z)) {
    return x > AZUMAYA.x0 && x < AZUMAYA.x1 && z > AZUMAYA.z0 && z < AZUMAYA.z1 ? '半露天區（池中）' : '主池';
  }
  if (x > AZUMAYA.x0 && x < AZUMAYA.x1 && z > AZUMAYA.z0 && z < AZUMAYA.z1) return '半露天區';
  if (z > 2.5 && x < 3) return '石板小徑';
  return '池畔';
}

export const LABELS = [
  ['湯屋簷廊（起點）', -7.5, 2.4, 9.6],
  ['入口・千鳥破風', -4.94, 4.6, 8.2],
  ['石板小徑', -5.6, 1.6, 6],
  ['半露天區', -6.8, 4.3, -1],
  ['主池', 0.5, 2.4, -2.6],
  ['池中大岩', CENTER_ROCK.x, 1.9, CENTER_ROCK.z],
  ['湯口', YUGUCHI.x + 0.6, 2.6, YUGUCHI.z],
  ['望景木台', 0, 2.4, -10.5],
  ['山谷・遠山（敞開面）', 0, 5.5, -26],
  ['鹿威し', PROPS.shishi.x, 1.6, PROPS.shishi.z],
  ['木桶', PROPS.oke.x, 1.2, PROPS.oke.z],
  ['牛奶', PROPS.milk.x, 1.7, PROPS.milk.z],
];
