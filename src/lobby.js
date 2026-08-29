/*
 * NESTIR 大廳 — 3D 沉浸入口（WebGPU / vgpu）。
 *
 * 一座 raymarched 空間，每個工具是一顆漂浮節點；HTML 標籤疊在其投影位置。
 * - 指標移動 = 「抓住世界」parallax（指標向右 → 畫面向右移）；點擊節點進入工具。
 * - 設定面板可手動切換 3D 空間／2D 平面（用於測試 fallback），選擇記憶在 localStorage。
 * - WebGPU 不可用或 init 失敗時自動退到 2D icon 網格（安全網頁後備頁）。
 */
import { init, effect, surface, frameLoop } from 'vgpu';
import { buildShader, TOOLS, BASE_CAM, TAN_HALF, NODE_RADIUS } from './lobby-scene.js';

// ---- 小型向量運算（與 shader 內公式完全一致）----
const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  norm: (a) => {
    const l = v3.len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

// 依目前 look 建立 camera basis（forward / right / up），與 shader 同構。
function cameraBasis(camPos, camLook) {
  const forward = v3.norm(v3.sub(camLook, camPos));
  const worldUp = [0, 1, 0];
  const right = v3.norm(v3.cross(forward, worldUp));
  const up = v3.cross(right, forward);
  return { forward, right, up };
}

// 世界點 → 螢幕座標（含深度）。z <= eps 代表在鏡頭後方。
function project(point, camPos, camLook, width, height) {
  const { forward, right, up } = cameraBasis(camPos, camLook);
  const rel = v3.sub(point, camPos);
  const z = v3.dot(rel, forward);
  if (z <= 0.02) return null;
  const x = v3.dot(rel, right);
  const y = v3.dot(rel, up);
  const aspect = width / height;
  const ndcX = x / (z * TAN_HALF * aspect);
  const ndcY = y / (z * TAN_HALF);
  return {
    x: ((ndcX + 1) / 2) * width,
    y: ((ndcY + 1) / 2) * height,
    depth: z,
  };
}

// 由像素座標發射射線，回傳擊中的節點索引（最近）或 -1。
function pickNode(px, py, camPos, camLook, width, height, tools) {
  const { forward, right, up } = cameraBasis(camPos, camLook);
  const aspect = width / height;
  const ndcX = (px / width) * 2 - 1;
  const ndcY = (py / height) * 2 - 1;
  const dir = v3.norm([
    forward[0] + TAN_HALF * ndcX * aspect * right[0] + TAN_HALF * ndcY * up[0],
    forward[1] + TAN_HALF * ndcX * aspect * right[1] + TAN_HALF * ndcY * up[1],
    forward[2] + TAN_HALF * ndcX * aspect * right[2] + TAN_HALF * ndcY * up[2],
  ]);
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < tools.length; i++) {
    const oc = v3.sub(camPos, tools[i].pos);
    const b = v3.dot(oc, dir);
    const c = v3.dot(oc, oc) - NODE_RADIUS * NODE_RADIUS;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < bestT) {
      bestT = t;
      best = i;
    }
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

function toolIcon(tool) {
  const initials = tool.name.replace(/SN|S N/gi, '').trim().slice(0, 2) || tool.name.slice(0, 2);
  return initials.toUpperCase();
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

function buildFallback(container) {
  container.classList.add('fallback-grid');
  const heading = el('div', 'fallback-heading');
  heading.appendChild(el('h1', null, 'NESTIR 大廳'));
  heading.appendChild(el('p', null, '2D 平面模式。可經設定切回 3D 空間（需 WebGPU）。'));
  container.appendChild(heading);

  const grid = el('div', 'fallback-cards');
  for (const tool of TOOLS) {
    const card = el('button', 'fallback-card' + (tool.active ? ' fallback-card--active' : ' fallback-card--soon'));
    const badge = el('span', 'fallback-card__icon');
    badge.textContent = toolIcon(tool);
    badge.style.setProperty('--node-color', tool.color);
    const body = el('span', 'fallback-card__body');
    body.appendChild(el('strong', null, tool.name));
    body.appendChild(el('span', 'fallback-card__zh', tool.zh));
    body.appendChild(el('span', 'fallback-card__status', tool.active ? '可進入' : '即將推出'));
    card.appendChild(badge);
    card.appendChild(body);
    if (tool.active) card.addEventListener('click', () => (location.href = tool.url));
    else card.addEventListener('click', () => showToast(`${tool.name} — 即將推出`));
    grid.appendChild(card);
  }
  container.appendChild(grid);
  container.hidden = false;
}

function buildLabels(labelsContainer, tools) {
  for (const tool of tools) {
    const label = el('div', 'node-label' + (tool.active ? ' node-label--active' : ''));
    const dot = el('span', 'node-label__dot');
    dot.textContent = toolIcon(tool);
    dot.style.setProperty('--node-color', tool.color);
    const name = el('span', 'node-label__name');
    name.textContent = tool.name;
    const zh = el('span', 'node-label__zh');
    zh.textContent = tool.active ? tool.zh : '即將推出';
    label.appendChild(dot);
    label.appendChild(name);
    label.appendChild(zh);
    labelsContainer.appendChild(label);
  }
  return [...labelsContainer.querySelectorAll('.node-label')];
}

// ---- 狀態 ----
const STORAGE_KEY = 'nestir-lobby-mode';
const PARALLAX = { x: 0.55, y: 0.4 }; // 抓握式：指標向右 → 畫面向右
const canvas = document.querySelector('#scene');
const labelsContainer = document.querySelector('#labels');
const fallback = document.querySelector('#fallback');
const hint = document.querySelector('#hint');

const state = {
  camPos: [...BASE_CAM.pos],
  camLook: [...BASE_CAM.look],
  hover: -1,
  mode: '2d', // '3d' | '2d'
  reason: '',
  gpu: null,
  loop: null,
  eff: null,
  surface: null,
  labels: [],
  busy: false,
};

function setHint(text) {
  if (hint) hint.textContent = text;
}

function uniforms() {
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
  return {
    time: performance.now() * 0.001,
    aspect,
    camX: state.camPos[0], camY: state.camPos[1], camZ: state.camPos[2],
    lookX: state.camLook[0], lookY: state.camLook[1], lookZ: state.camLook[2],
    hover: state.hover,
  };
}

function updateLabels() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (let i = 0; i < state.labels.length; i++) {
    const p = project(TOOLS[i].pos, state.camPos, state.camLook, w, h);
    if (!p) {
      state.labels[i].style.opacity = '0';
      continue;
    }
    const scale = Math.max(0.62, Math.min(1, 1.6 / p.depth));
    state.labels[i].style.opacity = '1';
    state.labels[i].style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${scale})`;
    state.labels[i].style.zIndex = String(1000 - Math.round(p.depth * 100));
  }
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
    syncModeUI();
    return;
  }
  state.busy = true;
  try {
    const gpu = await init();
    const surf = surface(gpu, canvas, { dpr: [1, 2], clearColor: [0.012, 0.03, 0.055, 1] });
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
    if (!state.labels.length) state.labels = buildLabels(labelsContainer, TOOLS);
    canvas.hidden = false;
    labelsContainer.hidden = false;
    fallback.hidden = true;
    fallback.innerHTML = '';
    state.reason = '';
    state.mode = '3d';
    state.loop = frameLoop(gpu, (frame) => {
      eff.set(uniforms());
      frame.pass(surf, eff);
      updateLabels();
    });
    setHint('移動指標環顧（抓握式）· 點擊節點進入工具');
  } catch (err) {
    console.error('WebGPU init failed:', err);
    state.reason = 'WebGPU 初始化失敗';
    enable2D();
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
  labelsContainer.hidden = true;
  labelsContainer.innerHTML = '';
  state.labels = [];
  if (fallback.hidden) buildFallback(fallback);
  fallback.hidden = false;
  state.mode = '2d';
  setHint('2D 平面模式 · 點擊卡片進入工具');
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

// ---- 指標與點擊（抓握式 parallax：指標方向 = 畫面移動方向）----
function onPointerMove(e) {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width - 0.5;
  const ny = (e.clientY - rect.top) / rect.height - 0.5;
  state.camLook = [
    BASE_CAM.look[0] - nx * PARALLAX.x,
    BASE_CAM.look[1] + ny * PARALLAX.y,
    BASE_CAM.look[2],
  ];
  state.hover = pickNode(e.clientX - rect.left, e.clientY - rect.top, state.camPos, state.camLook, rect.width, rect.height, TOOLS);
  canvas.style.cursor = state.hover >= 0 ? 'pointer' : 'default';
}

function onPointerLeave() {
  state.camLook = [...BASE_CAM.look];
  state.hover = -1;
  canvas.style.cursor = 'default';
}

function onClick(e) {
  const rect = canvas.getBoundingClientRect();
  const idx = pickNode(e.clientX - rect.left, e.clientY - rect.top, state.camPos, state.camLook, rect.width, rect.height, TOOLS);
  if (idx < 0) return;
  const tool = TOOLS[idx];
  if (tool.active) location.href = tool.url;
  else showToast(`${tool.name} — 即將推出`);
}

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
      state.camLook = [...BASE_CAM.look];
      state.hover = -1;
      showToast('視角已重置');
    });
  }
}

// ---- 啟動 ----
function start() {
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('click', onClick);
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
