/*
 * NESTIR 大廳 —— 互動層（3D 方塊 + 卡片）。
 *   - WebGPU raymarched 3D 空間：方形節點（Apple 連續曲率）＋ 光照／脈動／hover／霧
 *   - 每個節點上面疊一個 HTML app icon（方塊投影位置對齊，圓角同 shader 一樣）
 *   - 點方塊 → 卡片由下往上滑出（唔跳頁）；卡內兩個掣：網頁工具 / App
 *   - 無 WebGPU 自動退到 2D 卡片網格
 */
import { init, effect, surface, frameLoop } from 'vgpu';
import { buildShader, TOOLS, BASE_CAM, TAN_HALF, TILE_A } from './lobby-scene.js';

const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => {
    const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

function cameraBasis(camPos, camLook) {
  const forward = v3.norm(v3.sub(camLook, camPos));
  const right = v3.norm(v3.cross(forward, [0, 1, 0]));
  return { forward, right, up: v3.cross(right, forward) };
}

function project(point, camPos, camLook, w, h) {
  const { forward, right, up } = cameraBasis(camPos, camLook);
  const rel = v3.sub(point, camPos);
  const z = v3.dot(rel, forward);
  if (z <= 0.02) return null;
  const ndcX = v3.dot(rel, right) / (z * TAN_HALF * (w / h));
  const ndcY = v3.dot(rel, up) / (z * TAN_HALF);
  return { x: ((ndcX + 1) / 2) * w, y: ((ndcY + 1) / 2) * h, depth: z };
}

function pickNode(px, py, camPos, camLook, w, h) {
  const { forward, right, up } = cameraBasis(camPos, camLook);
  const aspect = w / h;
  const ndcX = (px / w) * 2 - 1;
  const ndcY = (py / h) * 2 - 1;
  const dir = v3.norm([
    forward[0] + TAN_HALF * ndcX * aspect * right[0] + TAN_HALF * ndcY * up[0],
    forward[1] + TAN_HALF * ndcX * aspect * right[1] + TAN_HALF * ndcY * up[1],
    forward[2] + TAN_HALF * ndcX * aspect * right[2] + TAN_HALF * ndcY * up[2],
  ]);
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < TOOLS.length; i++) {
    const oc = v3.sub(camPos, TOOLS[i].pos);
    const b = v3.dot(oc, dir);
    const c = v3.dot(oc, oc) - TILE_A * TILE_A * 2;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < bestT) { bestT = t; best = i; }
  }
  return best;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const initials = (t) => {
  const latin = t.name.replace(/SN/gi, '').trim().split(/\s+/).map((w) => w[0]).join('');
  if (/[A-Za-z]/.test(latin)) return latin.slice(0, 2).toUpperCase();
  return t.name.slice(0, 1);
};

// ── 卡片（由下往上滑出） ──
const card = document.querySelector('#card');
let cardIndex = -1;

function openCard(i) {
  const t = TOOLS[i];
  cardIndex = i;
  card.querySelector('#card-title').textContent = t.name;
  card.querySelector('#card-zh').textContent = `${t.zh} · ${t.status}`;
  const webBtn = card.querySelector('#card-web');
  const appBtn = card.querySelector('#card-app');
  const tileBox = card.querySelector('#card-icon');
  tileBox.innerHTML = '';
  tileBox.style.setProperty('--node-color', t.color);
  if (t.icon) tileBox.appendChild(el('img', null)).src = t.icon;
  else tileBox.appendChild(el('span', 'letter', initials(t)));

  if (t.url) {
    webBtn.href = t.url;
    webBtn.classList.remove('act--off');
    webBtn.querySelector('small').textContent = '直接用，唔使裝';
  } else {
    webBtn.removeAttribute('href');
    webBtn.classList.add('act--off');
    webBtn.querySelector('small').textContent = '網頁版開發中';
  }
  if (t.appUrl) {
    appBtn.href = t.appUrl;
    appBtn.classList.remove('act--off');
    appBtn.querySelector('small').textContent = '去 App Store 下載';
  } else {
    appBtn.removeAttribute('href');
    appBtn.classList.add('act--off');
    appBtn.querySelector('small').textContent = t.active ? 'App 開發中' : '開發中';
  }
  document.body.classList.add('card-open');
}

function closeCard() {
  cardIndex = -1;
  document.body.classList.remove('card-open');
}
document.querySelector('#card-close').addEventListener('click', closeCard);
document.querySelector('#scrim').addEventListener('click', closeCard);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });

// ── 3D 圖層（app icon 疊在方塊投影位置） ──
let tiles = [];
const canvas = document.querySelector('#scene');
const tilesBox = document.querySelector('#tiles');

function buildTiles() {
  tilesBox.innerHTML = '';
  tiles = TOOLS.map((t, i) => {
    const box = el('button', 'tile3d' + (t.active ? '' : ' tile3d--soon'));
    box.style.setProperty('--node-color', t.color);
    box.type = 'button';
    box.setAttribute('aria-label', t.name);
    if (t.icon) box.appendChild(el('img', null)).src = t.icon;
    else box.appendChild(el('span', 'letter', initials(t)));
    box.addEventListener('click', () => openCard(i));
    tilesBox.appendChild(box);
    return box;
  });
}

function updateTiles() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (let i = 0; i < tiles.length; i++) {
    const c = TOOLS[i].pos;
    const p = project(c, state.camPos, state.camLook, w, h);
    if (!p) { tiles[i].style.opacity = '0'; continue; }
    // 用方塊兩個角投影，得出螢幕上實際大小（保持同 3D 完全對齊）
    const px = project([c[0] + TILE_A, c[1], c[2]], state.camPos, state.camLook, w, h);
    const py = project([c[0], c[1] + TILE_A, c[2]], state.camPos, state.camLook, w, h);
    const size = Math.max(28, Math.abs(px.x - p.x) * 2);
    tiles[i].style.opacity = '1';
    tiles[i].style.width = `${size.toFixed(1)}px`;
    tiles[i].style.height = `${size.toFixed(1)}px`;
    tiles[i].style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
    tiles[i].style.zIndex = String(900 - Math.round(p.depth * 100));
    tiles[i].style.setProperty('--iso', TOOLS[i].active ? '1' : '0.55');
    tiles[i].style.fontSize = (size * 0.34).toFixed(1) + 'px';
  }
}

// ── 狀態 / 3D 啟動 ──
const PARALLAX = { x: 0.55, y: 0.4 };
const state = { camPos: [...BASE_CAM.pos], camLook: [...BASE_CAM.look], hover: -1, gpu: null, loop: null, busy: false };
const fallback = document.querySelector('#fallback');

function uniforms() {
  return {
    time: performance.now() * 0.001,
    aspect: canvas.clientWidth / Math.max(canvas.clientHeight, 1),
    camX: state.camPos[0], camY: state.camPos[1], camZ: state.camPos[2],
    lookX: state.camLook[0], lookY: state.camLook[1], lookZ: state.camLook[2],
    hover: state.hover,
  };
}

window.addEventListener('pointermove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = (e.clientY / window.innerHeight) * 2 - 1;
  const r = canvas.getBoundingClientRect();
  state.camPos[0] = BASE_CAM.pos[0] - nx * PARALLAX.x;
  state.camPos[1] = BASE_CAM.pos[1] + ny * PARALLAX.y;
  if (!canvas.hidden) {
    const hit = pickNode(e.clientX - r.left, e.clientY - r.top, state.camPos, state.camLook, r.width, r.height);
    state.hover = hit;
    canvas.style.cursor = hit >= 0 ? 'pointer' : 'default';
  }
});

function buildFallback() {
  fallback.innerHTML = '';
  fallback.appendChild(el('h2', null, 'NESTIR 大廳（2D 後備）'));
  const grid = el('div', 'fb-grid');
  TOOLS.forEach((t, i) => {
    const b = el('button', 'fb-card');
    b.style.setProperty('--node-color', t.color);
    b.appendChild(el('span', 'fb-ic', t.icon ? '' : initials(t)));
    if (t.icon) b.querySelector('.fb-ic').appendChild(el('img', null)).src = t.icon;
    b.appendChild(el('strong', null, t.name));
    b.appendChild(el('small', null, t.status));
    b.addEventListener('click', () => openCard(i));
    grid.appendChild(b);
  });
  fallback.appendChild(grid);
  fallback.hidden = false;
}

async function enable3D() {
  if (!navigator.gpu) { buildFallback(); document.querySelector('#hint').textContent = '此裝置不支援 WebGPU — 已用 2D 後備'; return; }
  try {
    const gpu = await init();
    const surf = surface(gpu, canvas, { dpr: [1, 2], clearColor: [0.914, 0.918, 0.906, 1] });
    const eff = effect(gpu, buildShader(TOOLS), {
      label: 'nestir-lobby',
      set: { time: 0, aspect: 1, camX: 0, camY: 0, camZ: 0, lookX: 0, lookY: 0, lookZ: 3.2, hover: -1 },
    });
    state.gpu = gpu;
    buildTiles();
    canvas.hidden = false;
    tilesBox.hidden = false;
    document.querySelector('#hint').textContent = '移動指標環顧 · 點方塊開卡片 · 卡片兩邊揀「網頁工具」或「App」';
    state.loop = frameLoop(gpu, (frame) => {
      eff.set(uniforms());
      frame.pass(surf, eff);
      updateTiles();
    });
  } catch (err) {
    console.error('WebGPU init failed:', err);
    buildFallback();
    document.querySelector('#hint').textContent = 'WebGPU 初始化失敗 — 已用 2D 後備';
  }
}

enable3D();
