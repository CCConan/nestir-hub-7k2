/*
 * NESTIR 大廳 — 場景定義 + WGSL shader 產生器。
 *
 * 設計要點：
 *   1. 節點由「球體」改成「iPhone app icon 比例嘅方塊」：
 *      sdTile() = 擠出式 superellipse（|x|^n+|y|^n)^(1/n) - a，n=4（Apple 連續曲率）
 *   2. 工具由 8 個補齊到 9 個（同官網 Apps 頁一致），排成 3×3 格
 *   3. 每個工具帶 status / url / appUrl / icon，畀 HTML 圖層同卡片用
 */

export const TAN_HALF = 0.55; // fov_y ≈ 57.6°，與 shader 必須一致
export const TILE_A = 0.42; // 方塊半邊長（正方形 = 0.84）
export const TILE_H = 0.075; // 半厚度
export const SQUIRCLE_N = 4.0; // Apple 連續曲率指數
export const BASE_CAM = { pos: [0, 0, 0], look: [0, 0, 3.2] };

const R1 = 2.95; // 第一行深度
const R2 = 2.7;
const R3 = 2.85;
const X = [-1.05, 0, 1.05];

export const TOOLS = [
  { id: 'poplist', name: 'PopList SN', zh: '現場視覺查詢', status: 'Live', active: true,
    url: 'https://poplist.studionestir.com/', appUrl: null, color: '#347A5B', icon: null, pos: [X[0], 0.95, R1] },
  { id: 'missionrelay', name: 'MissionRelay SN', zh: '中繼與互助', status: 'Live', active: true,
    url: 'missionrelay.html', appUrl: null, color: '#CC7A00', icon: null, pos: [X[1], 0.95, R1] },
  { id: 'receipt', name: '張單據夾', zh: 'Receipt · 雲端驗證', status: 'Live', active: true,
    url: 'receipt.html', appUrl: null, color: '#A8836B', icon: 'assets/apps/receipt-app-256.png', pos: [X[2], 0.95, R1] },

  { id: 'tubelist', name: 'TubeList SN', zh: 'YouTube 清單整理', status: 'Beta', active: true,
    url: null, appUrl: null, color: '#C4302B', icon: 'assets/apps/tubelist-app-256.png', pos: [X[0], 0, R2] },
  { id: 'tripboard', name: 'TripBoard SN', zh: '遠行與行程', status: 'In development', active: false,
    url: null, appUrl: null, color: '#6B7FA3', icon: 'assets/apps/tripboard-app-256.png', pos: [X[1], 0, R2] },
  { id: 'bodygravity', name: 'BodyGravity SN', zh: '身體準備', status: 'In development', active: false,
    url: null, appUrl: null, color: '#3E7C8C', icon: null, pos: [X[2], 0, R2] },

  { id: 'knowledge', name: 'KnowledgeCards SN', zh: '兒童知識卡', status: 'In development', active: false,
    url: null, appUrl: null, color: '#8A6DA8', icon: null, pos: [X[0], -0.95, R3] },
  { id: 'eatingmap', name: '記憶地圖', zh: '食物・回憶 3D 地球', status: 'In development', active: false,
    url: null, appUrl: null, color: '#C2571F', icon: null, pos: [X[1], -0.95, R3] },
  { id: 'nanahub', name: 'NanaHub', zh: '家與社群', status: 'In development', active: false,
    url: null, appUrl: null, color: '#C9A24B', icon: null, pos: [X[2], -0.95, R3] },
];

function hexToVec3(hex) {
  const h = hex.replace('#', '');
  return `vec3f(${parseInt(h.slice(0, 2), 16) / 255}, ${parseInt(h.slice(2, 4), 16) / 255}, ${parseInt(h.slice(4, 6), 16) / 255})`;
}

export function buildShader(tools) {
  const n = tools.length;
  return /* wgsl */ `
struct Params {
  time: f32,
  aspect: f32,
  camX: f32, camY: f32, camZ: f32,
  lookX: f32, lookY: f32, lookZ: f32,
  hover: f32,
}
@group(0) @binding(0) var<uniform> params: Params;

const NODE_COUNT: u32 = ${n}u;
const TILE_A: f32 = ${TILE_A};
const TILE_H: f32 = ${TILE_H};
const SQ_N: f32 = ${SQUIRCLE_N};
const TAN_HALF: f32 = ${TAN_HALF};
const MAX_DIST: f32 = 26.0;

const NODE_POS: array<vec3f, ${n}> = array<vec3f, ${n}>(
  ${tools.map((t) => `vec3f(${t.pos.map((v) => v.toFixed(3)).join(', ')})`).join(',\n  ')}
);
const NODE_COL: array<vec3f, ${n}> = array<vec3f, ${n}>(
  ${tools.map((t) => '  ' + hexToVec3(t.color)).join(',\n')}
);

// Apple 式連續曲率方塊：擠出式 superellipse，n=4
fn sdTile(p: vec3f) -> f32 {
  let q = abs(p.xy);
  let r = pow(pow(q.x, SQ_N) + pow(q.y, SQ_N), 1.0 / SQ_N);
  return max(r - TILE_A, abs(p.z) - TILE_H);
}

fn map(p: vec3f) -> f32 {
  var d: f32 = p.y + 2.4;            // 遠方地面，保留空間感
  for (var i: u32 = 0u; i < NODE_COUNT; i = i + 1u) {
    d = min(d, sdTile(p - NODE_POS[i]));
  }
  return d;
}

fn calcNormal(p: vec3f) -> vec3f {
  let e = vec3f(0.0015, 0.0, 0.0);
  return normalize(vec3f(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let cam = vec3f(params.camX, params.camY, params.camZ);
  let look = vec3f(params.lookX, params.lookY, params.lookZ);
  let forward = normalize(look - cam);
  let worldUp = vec3f(0.0, 1.0, 0.0);
  let right = normalize(cross(forward, worldUp));
  let up = cross(right, forward);

  let ndc = uv * 2.0 - 1.0;
  let dir = normalize(forward + TAN_HALF * ndc.x * params.aspect * right + TAN_HALF * ndc.y * up);

  let bg = vec3f(0.914, 0.918, 0.906);
  var col = bg;
  var t = 0.0;

  for (var s: i32 = 0; s < 112; s = s + 1) {
    let p = cam + dir * t;
    let d = map(p);
    if (d < 0.0012) {
      let nrm = calcNormal(p);
      let ndl = max(dot(nrm, normalize(vec3f(0.35, 0.8, 0.45))), 0.0);
      var nodeCol = vec3f(0.32, 0.36, 0.40);
      var glow = 0.0;
      for (var i: u32 = 0u; i < NODE_COUNT; i = i + 1u) {
        if (sdTile(p - NODE_POS[i]) < 0.02) {
          nodeCol = NODE_COL[i];
          let pulse = 0.5 + 0.5 * sin(params.time * 1.6 + f32(i) * 1.9);
          glow = 0.16 + 0.12 * pulse;
          if (f32(i) == params.hover) { glow = glow + 0.42; }
          i = NODE_COUNT;
        }
      }
      col = nodeCol * (0.24 + 0.82 * ndl) + nodeCol * glow;
      let fog = 1.0 - exp(-0.16 * t);
      col = mix(col, bg, fog);
      break;
    }
    t = t + max(d, 0.0009);
    if (t > MAX_DIST) { break; }
  }

  let r2 = dot(ndc, ndc);
  col = col * (1.0 - 0.10 * r2);
  return vec4f(col, 1.0);
}
`;
}
