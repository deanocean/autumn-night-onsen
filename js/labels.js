// 區域標籤與鳥瞰視角：確認配置用的輔助工具（L 鍵、M 鍵切換）。
import * as THREE from 'three';
import { LABELS } from './layout.js';
import { OVERHEAD } from './world.js';

function label(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '500 44px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif TC", serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  c.width = w; c.height = 76;
  ctx.font = font;
  ctx.fillStyle = 'rgba(18,16,20,0.8)';
  ctx.fillRect(0, 0, w, 76);
  ctx.fillStyle = '#f3ece0';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 24, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false, toneMapped: false }));
  s.scale.set((w / 76) * 0.55, 0.55, 1);
  s.renderOrder = 30;
  return s;
}

export function createGuides(scene) {
  const labels = new THREE.Group();
  LABELS.forEach(([text, x, y, z]) => {
    const s = label(text);
    s.position.set(x, y, z);
    labels.add(s);
  });
  labels.visible = false;
  scene.add(labels);

  const topCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
  topCam.up.set(0, 0, -1); // 畫面上方為北

  // 鳥瞰時標出自己位置與面向的箭頭
  const marker = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 3), new THREE.MeshBasicMaterial({ color: 0xe8483a, depthTest: false, fog: false, toneMapped: false }));
  cone.rotation.x = -Math.PI / 2;
  cone.renderOrder = 31;
  marker.add(cone);
  marker.visible = false;
  scene.add(marker);

  let top = false;
  function setTop(v) {
    top = v;
    OVERHEAD.forEach((o) => { o.visible = !v; });
    marker.visible = v;
  }
  return {
    labels, topCam,
    get top() { return top; },
    toggleTop() { setTop(!top); },
    setTop,
    toggleLabels() { labels.visible = !labels.visible; },
    resize(w, h) {
      const half = 17, asp = w / h;
      const hx = asp >= 1 ? half * asp : half, hz = asp >= 1 ? half : half / asp;
      topCam.left = -hx; topCam.right = hx; topCam.top = hz; topCam.bottom = -hz;
      topCam.position.set(0, 80, 1);
      topCam.lookAt(0, 0, 1);
      topCam.updateProjectionMatrix();
    },
    update(player, camera) {
      if (top) {
        marker.position.set(player.pos.x, 14, player.pos.z);
        marker.rotation.y = player.yaw;
      }
      if (labels.visible) {
        for (const s of labels.children) {
          const d = top ? 99 : s.position.distanceTo(camera.position);
          s.material.opacity = Math.min(1, Math.max(0, (d - 3.5) / 2.5));
        }
      }
    },
  };
}
