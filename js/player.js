import * as THREE from 'three';
import { groundY, inWater, circles, boxes, BOUNDS, START, POOL } from './layout.js';

// 移動與視角（每格都會讀，開發者面板可即時調）
export const MOVE = {
  walk: 2.3,      // 步行速度（m/s）
  run: 4.2,       // 按住 Shift 快走
  eye: 1.62,      // 站立時的視線高度
  look: 0.0021,   // 滑鼠鎖定時的轉頭靈敏度（拖曳模式照比例放大到 0.004）
};
const RADIUS = 0.34;

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3(START.x, groundY(START.x, START.z), START.z);
    this.yaw = START.yaw;
    this.pitch = -0.04;
    this.vel = new THREE.Vector2();
    this.keys = new Set();
    this.enabled = false;
    this.dragging = false;
    this.bob = 0;
    this.wading = false;
    // 坐下、泡湯等姿勢（由 interact.js 設定）
    this.eye = MOVE.eye;        // 目前的視線高度（相對腳下）
    this.eyeTarget = null; // 要降到的視線高度；null = 站立
    this.frozen = false;   // 不能走動（仍可轉頭）
    this.anchor = null;    // { x, z, release }：被帶往這個位置，不做碰撞；release 為 true 時到位後放開

    addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('.dev-panel')) return; // 在開發者面板裡打字
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      const locked = document.pointerLockElement === dom;
      if (!locked && !this.dragging) return;
      const k = locked ? MOVE.look : MOVE.look * (0.004 / 0.0021);
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.45, Math.min(1.5, this.pitch - e.movementY * k));
    });
    dom.addEventListener('mousedown', () => { this.dragging = true; });
    addEventListener('mouseup', () => { this.dragging = false; });
  }

  // 只能在點擊事件中呼叫；被拒絕時退回「按住拖曳」模式
  lock() {
    try {
      const p = this.dom.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* 拖曳模式仍可用 */ }
  }

  update(dt) {
    const k = this.keys;
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (!this.enabled || this.frozen || this.anchor) { f = 0; s = 0; }
    const len = Math.hypot(f, s) || 1;
    f /= len; s /= len;

    this.wading = inWater(this.pos.x, this.pos.z);
    let speed = k.has('ShiftLeft') || k.has('ShiftRight') ? MOVE.run : MOVE.walk;
    if (this.wading) speed *= 0.55;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const tx = (-sin * f + cos * s) * speed;
    const tz = (-cos * f - sin * s) * speed;
    const ease = 1 - Math.exp(-dt * (this.wading ? 5 : 10));
    this.vel.x += (tx - this.vel.x) * ease;
    this.vel.y += (tz - this.vel.y) * ease;

    let x = this.pos.x + this.vel.x * dt;
    let z = this.pos.z + this.vel.y * dt;

    if (this.anchor) {
      const a = this.anchor, e = 1 - Math.exp(-dt * 5);
      this.vel.set(0, 0);
      x = this.pos.x + (a.x - this.pos.x) * e;
      z = this.pos.z + (a.z - this.pos.z) * e;
      if (a.release && Math.hypot(a.x - x, a.z - z) < 0.04) this.anchor = null;
    }
    for (let pass = 0; pass < 2 && !this.anchor; pass++) {
      for (const c of circles) {
        const dx = x - c.x, dz = z - c.z;
        const min = c.r + RADIUS;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
      }
      for (const b of boxes) {
        const nx = Math.max(b.x0, Math.min(b.x1, x));
        const nz = Math.max(b.z0, Math.min(b.z1, z));
        const dx = x - nx, dz = z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < RADIUS * RADIUS) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            x = nx + (dx / d) * RADIUS;
            z = nz + (dz / d) * RADIUS;
          } else {
            // 圓心落在矩形內：從最近的一邊推出去
            const l = x - b.x0, r = b.x1 - x, t = z - b.z0, u = b.z1 - z;
            const m = Math.min(l, r, t, u);
            if (m === l) x = b.x0 - RADIUS; else if (m === r) x = b.x1 + RADIUS;
            else if (m === t) z = b.z0 - RADIUS; else z = b.z1 + RADIUS;
          }
        }
      }
    }
    x = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, x));
    z = Math.max(BOUNDS.z0, Math.min(BOUNDS.z1, z));

    this.pos.x = x;
    this.pos.z = z;
    const gy = groundY(x, z);
    this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-dt * 9));

    const moving = Math.hypot(this.vel.x, this.vel.y);
    this.bob += dt * moving * 3.1;
    const bobY = Math.sin(this.bob * 2) * 0.022 * Math.min(1, moving / 2);

    this.eye += ((this.eyeTarget ?? MOVE.eye) - this.eye) * (1 - Math.exp(-dt * 3.5));
    this.camera.position.set(x, this.pos.y + this.eye + bobY, z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  get waterDepth() {
    return Math.max(0, POOL.waterY - this.pos.y);
  }
}
