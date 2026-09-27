/*
 * NESTIR 大廳 — 3D 沉浸入口（WebGPU / vgpu）。
 *
 * 一座 raymarched 空間，每個工具是一塊漂浮方塊（Apple 連續曲率）；
 * 方塊上疊 HTML app icon，方塊下方疊 HTML 名牌（name + zh），兩者都跟 3D 投影位置。
 * - 指標移動 = 「抓住世界」parallax（指標向右 → 畫面向右移）；點方塊 → 卡片由下往上滑出。
 * - 設定面板可手動切換 3D 空間／2D 平面（用於測試 fallback），選擇記憶在 localStorage。
 * - WebGPU 不可用或 init 失敗時自動退到 2D icon 網格（安全網頁後備頁）。
 */
import { init, effect, surface, frameLoop } from 'vgpu';
import { buildShader, TOOLS, BASE_CAM, TAN_HALF, TILE_A } from './lobby-scene.js';

// ---- 小型向量運算（與 shader 內公式完全一致）----
const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm: (a) => {
    const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

// 依目前 look 建立 camera basis（forward / right / up），與 shader 同構。
function cameraBasis(camPos, camLook) {
  const forward = v3.norm(v3.sub(camLook, camPos));
  const right = v3.norm(v3.cross(forward, [0, 1, 0]));
  return { forward, right, up: v3.cross(right, forward) };
}

// 世界點 → 螢幕座標（含深度）。z <= eps 代表在鏡頭後方。
function project(point, camPos, camLook, w, h) {
  const { forward, right, up } = cameraBasis(camPos, camLook);
  const rel = v3.sub(point, camPos);
  const z = v3.dot(rel, forward);
  if (z <= 0.02) return null;
  const ndcX = v3.dot(rel, right) / (z * TAN_HALF * (w / h));
  const ndcY = v3.dot(rel, up) / (z * TAN_HALF);
  return { x: ((ndcX + 1) / 2) * w, y: ((ndcY + 1) / 2) * h, depth: z };
}

// 由像素座標發射射線，回傳擊中的節點索引（最近）或 -1。
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

// ---- DOM helpers ----
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function initials(tool) {
  const latin = tool.name.replace(/SN/gi, '').trim().split(/\s+/).map((w) => w[0]).join('');
  if (/[A-Za-z]/.test(latin)) return latin.slice(0, 2).toUpperCase();
  return tool.name.slice(0, 1);
}

function showToast(message) {
  let toast = document.querySelector('#toast');
  if (!toast) {
    toast = el('div', null);
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('toast--show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('toast--show'), 2200);
}

// ---- 卡片（由下往上滑出）----
const card = document.querySelector('#card');
let cardIndex = -1;

function openCard(i) {
  const t = TOOLS[i];
  cardIndex = i;
  card.querySelector('#card-title').textContent = t.name;
  card.querySelector('#card-zh').textContent = `${t.zh} · ${t.status}`;
  const webBtn = card.querySelector('#card-web');
  const appBtn = card.querySelector('#card-app');
  const iconBox = card.querySelector('#card-icon');
  iconBox.innerHTML = '';
  iconBox.style.setProperty('--node-color', t.color);
  if (t.icon) iconBox.appendChild(el('img', null)).src = t.icon;
  else iconBox.appendChild(el('span', 'letter', initials(t)));

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
  fadeHint();
}

function closeCard() {
  cardIndex = -1;
  document.body.classList.remove('card-open');
}
document.querySelector('#card-close').addEventListener('click', closeCard);
document.querySelector('#scrim').addEventListener('click', closeCard);

// ---- 狀態 ----
const STORAGE_KEY = 'nestir-lobby-mode';
// app icon 佔 3D 方塊幾大（0–1）：留白畀方塊本身嘅顏色／厚度／光影露出嚟
const ICON_SCALE = (() => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lobby-icon-scale'));
  return Number.isFinite(v) && v > 0.2 && v <= 1 ? v : 0.62;
})();
const PARALLAX = { x: 0.55, y: 0.4 }; // 抓握式：指標向右 → 畫面向右
const canvas = document.querySelector('#scene');
const tilesBox = document.querySelector('#tiles');
const labelsContainer = document.querySelector('#labels');
const fallback = document.querySelector('#fallback');
const hint = document.querySelector('#hint');

const state = {
  camPos: [...BASE_CAM.pos],
  camLook: [...BASE_CAM.look],
  hover: -1,
  mode: '', // '3d' | '2d'
  reason: '',
  gpu: null,
  loop: null,
  eff: null,
  surface: null,
  tiles: [],
  labels: [],
  busy: false,
};

let hintTimer = null;
function setHint(text) {
  if (!hint) return;
  hint.textContent = text;
  hint.classList.remove('is-faded');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(fadeHint, 6000);
}
function fadeHint() {
  if (hint) hint.classList.add('is-faded');
  clearTimeout(hintTimer);
}

function uniforms() {
  return {
    time: performance.now() * 0.001,
    aspect: canvas.clientWidth / Math.max(canvas.clientHeight, 1),
    camX: state.camPos[0], camY: state.camPos[1], camZ: state.camPos[2],
    lookX: state.camLook[0], lookY: state.camLook[1], lookZ: state.camLook[2],
    hover: state.hover,
  };
}

// ---- 方塊圖層（app icon 疊在方塊投影位置）----
function buildTiles() {
  tilesBox.innerHTML = '';
  state.tiles = TOOLS.map((t, i) => {
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
  for (let i = 0; i < state.tiles.length; i++) {
    const c = TOOLS[i].pos;
    const p = project(c, state.camPos, state.camLook, w, h);
    if (!p) { state.tiles[i].style.opacity = '0'; continue; }
    // 用方塊角落投影，得出螢幕上實際大小（同 3D 完全對齊）
    const px = project([c[0] + TILE_A, c[1], c[2]], state.camPos, state.camLook, w, h);
    // 方塊投影全闊 → app icon 只用其中 ICON_SCALE，其餘露出 3D 方塊
    const full = Math.abs(px.x - p.x) * 2;
    const size = Math.max(20, full * ICON_SCALE);
    state.tiles[i].style.opacity = '1';
    state.tiles[i].style.width = `${size.toFixed(1)}px`;
    state.tiles[i].style.height = `${size.toFixed(1)}px`;
    state.tiles[i].style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
    state.tiles[i].style.zIndex = String(900 - Math.round(p.depth * 100));
    state.tiles[i].style.fontSize = (size * 0.34).toFixed(1) + 'px';
  }
}

// ---- 名牌圖層（方塊下方：name + zh，跟深度縮放；hover 高亮）----
function buildLabels() {
  labelsContainer.innerHTML = '';
  state.labels = TOOLS.map((t) => {
    const label = el('div', 'node-label' + (t.active ? ' node-label--active' : ''));
    label.style.setProperty('--node-color', t.color);
    label.appendChild(el('span', 'node-label__name', t.name));
    label.appendChild(el('span', 'node-label__zh', t.active ? t.zh : '即將推出'));
    labelsContainer.appendChild(label);
    return label;
  });
}

function updateLabels() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (let i = 0; i < state.labels.length; i++) {
    // 投影方塊正下方一點（世界座標），名牌自然跟隨深度；
    // 注意：此相機 basis 下世界 +y 對應畫面下方，故用「+」先落喺方塊下面
    const c = TOOLS[i].pos;
    const p = project([c[0], c[1] + TILE_A * 1.24, c[2]], state.camPos, state.camLook, w, h);
    // 名牌只在 hover 嗰塊方塊出現（避免同下一行方塊疊住）
    const on = i === state.hover;
    state.labels[i].classList.toggle('is-hover', on);
    if (!p || !on) { state.labels[i].style.opacity = '0'; continue; }
    const scale = Math.max(0.62, Math.min(1, 1.6 / p.depth));
    state.labels[i].style.opacity = '1';
    state.labels[i].style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${scale})`;
    state.labels[i].style.zIndex = String(1000 - Math.round(p.depth * 100));
  }
}

// ---- 2D 後備網格 ----
function buildFallback(container) {
  container.classList.add('fallback-grid');
  container.innerHTML = '';
  const heading = el('div', 'fallback-heading');
  heading.appendChild(el('h1', null, 'NESTIR 大廳'));
  heading.appendChild(el('p', null, '2D 平面模式。可經設定切回 3D 空間（需 WebGPU）。'));
  container.appendChild(heading);

  const grid = el('div', 'fallback-cards');
  TOOLS.forEach((tool, i) => {
    const b = el('button', 'fallback-card' + (tool.active ? ' fallback-card--active' : ' fallback-card--soon'));
    b.style.setProperty('--node-color', tool.color);
    const badge = el('span', 'fallback-card__icon');
    if (tool.icon) badge.appendChild(el('img', null)).src = tool.icon;
    else badge.textContent = initials(tool);
    const body = el('span', 'fallback-card__body');
    body.appendChild(el('strong', null, tool.name));
    body.appendChild(el('span', 'fallback-card__zh', tool.zh));
    body.appendChild(el('span', 'fallback-card__status', tool.active ? '可進入' : '即將推出'));
    b.appendChild(badge);
    b.appendChild(body);
    b.addEventListener('click', () => openCard(i));
    grid.appendChild(b);
  });
  container.appendChild(grid);
  container.hidden = false;
}

// ---- 3D / 2D 切換 ----
function dispose3D() {
  if (state.loop) {
    try { state.loop.stop(); } catch (e) { /* noop */ }
    state.loop = null;
  }
  if (state.gpu) {
    try { state.gpu.dispose(); } catch (e) { /* noop */ }
    state.gpu = null;
  }
  state.surface = null;
  state.eff = null;
}

async function enable3D() {
  if (state.busy || state.mode === '3d') return;
  if (!navigator.gpu) {
    state.reason = '此裝置不支援 WebGPU';
    showToast(state.reason);
    enable2D();
    return;
  }
  state.busy = true;
  try {
    const gpu = await init();
    const surf = surface(gpu, canvas, { dpr: [1, 2], clearColor: [0.914, 0.918, 0.906, 1] });
    const eff = effect(gpu, buildShader(TOOLS), {
      label: 'nestir-lobby',
      set: {
        time: 0, aspect: 1,
        camX: state.camPos[0], camY: state.camPos[1], camZ: state.camPos[2],
        lookX: state.camLook[0], lookY: state.camLook[1], lookZ: state.camLook[2],
        hover: -1,
      },
    });
    state.gpu = gpu;
    state.surface = surf;
    state.eff = eff;
    if (!state.tiles.length) buildTiles();
    if (!state.labels.length) buildLabels();
    canvas.hidden = false;
    tilesBox.hidden = false;
    labelsContainer.hidden = false;
    fallback.hidden = true;
    fallback.innerHTML = '';
    state.reason = '';
    state.mode = '3d';
    state.loop = frameLoop(gpu, (frame) => {
      eff.set(uniforms());
      frame.pass(surf, eff);
      updateTiles();
      updateLabels();
    });
    setHint('移動指標環顧 · 點方塊開卡片 · 卡片兩邊揀「網頁工具」或「App」');
  } catch (err) {
    console.error('WebGPU init failed:', err);
    state.reason = 'WebGPU 初始化失敗';
    state.busy = false;
    enable2D();
    return;
  } finally {
    state.busy = false;
  }
  syncModeUI();
}

function enable2D() {
  if (state.mode === '2d' && !state.gpu) {
    syncModeUI();
    return;
  }
  dispose3D();
  canvas.hidden = true;
  tilesBox.hidden = true;
  labelsContainer.hidden = true;
  state.tiles = [];
  state.labels = [];
  buildFallback(fallback);
  fallback.hidden = false;
  state.mode = '2d';
  setHint('2D 平面模式 · 點卡片揀「網頁工具」或「App」');
  syncModeUI();
}

function applyMode(mode) {
  localStorage.setItem(STORAGE_KEY, mode);
  if (mode === '3d') enable3D();
  else enable2D();
}

function syncModeUI() {
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === state.mode);
  });
  const note = document.querySelector('#modeNote');
  if (note) {
    if (state.mode === '3d') note.textContent = 'WebGPU 空間模式';
    else note.textContent = state.reason ? `2D 平面模式（${state.reason}）` : '2D 平面模式（手動切換）';
  }
}

// ---- 指標與點擊（抓握式 parallax）----
window.addEventListener('pointermove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = (e.clientY / window.innerHeight) * 2 - 1;
  state.camPos[0] = BASE_CAM.pos[0] - nx * PARALLAX.x;
  state.camPos[1] = BASE_CAM.pos[1] + ny * PARALLAX.y;
  const r = canvas.getBoundingClientRect();
  if (!canvas.hidden) {
    state.hover = pickNode(e.clientX - r.left, e.clientY - r.top, state.camPos, state.camLook, r.width, r.height);
    canvas.style.cursor = state.hover >= 0 ? 'pointer' : 'default';
  }
});

window.addEventListener('pointerleave', () => {
  state.camPos = [...BASE_CAM.pos];
  state.camLook = [...BASE_CAM.look];
  state.hover = -1;
  canvas.style.cursor = 'default';
});

// ---- 設定面板 ----
function wireSettings() {
  const settingsBtn = document.querySelector('#settingsBtn');
  const panel = document.querySelector('#settingsPanel');
  if (!settingsBtn || !panel) return;

  settingsBtn.addEventListener('click', () => {
    const willShow = panel.hidden;
    panel.hidden = !willShow;
    settingsBtn.setAttribute('aria-expanded', String(willShow));
  });

  panel.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyMode(btn.dataset.mode);
      showToast(btn.dataset.mode === '3d' ? '已切換 3D 空間' : '已切換 2D 平面');
    });
  });

  const reset = panel.querySelector('#resetView');
  if (reset) {
    reset.addEventListener('click', () => {
      state.camPos = [...BASE_CAM.pos];
      state.camLook = [...BASE_CAM.look];
      state.hover = -1;
      showToast('視角已重置');
    });
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeCard();
  const panel = document.querySelector('#settingsPanel');
  const btn = document.querySelector('#settingsBtn');
  if (panel && !panel.hidden) {
    panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
});

// ---- 啟動 ----
function start() {
  wireSettings();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === '2d') {
    state.reason = '沿用上次設定';
    enable2D();
  } else {
    enable3D(); // WebGPU 失敗時自動 enable2D
  }
  window.addEventListener('pagehide', dispose3D, { once: true });
}

start();
