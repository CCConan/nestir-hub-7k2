/*
 * NESTIR 大廳場景定義 + WGSL shader 產生器。
 * 純模組：不 import vgpu、不碰 DOM，供瀏覽器 app 與 smoke test 共用。
 *
 * 每個工具 = 3D 空間中的一個「節點」（球體），HTML 標籤疊在其投影位置。
 * 節點位置與顏色只在這裡定義一次；shader 內以 compile-time array 常數注入，
 * 瀏覽器端的 ray picking / 標籤投影則讀同一份資料，確保視覺與互動一致。
 */

// 攝影機模型：與 shader 內 TAN_HALF / 基礎向量必須一致。
export const TAN_HALF = 0.55; // fov_y ≈ 2*atan(0.55) ≈ 57.6°
export const NODE_RADIUS = 0.34;
export const BASE_CAM = {
  pos: [0, 0, 0],
  look: [0, 0.05, 3.0],
};

export const TOOLS = [
  {
    id: 'poplist',
    name: 'PopList SN',
    zh: '現場視覺查詢',
    url: 'https://poplist.studionestir.com/',
    active: true,
    color: '#347A5B', // brand green
    pos: [1.5, 0.35, 1.5],
  },
  {
    id: 'missionrelay',
    name: 'MissionRelay SN',
    zh: '中繼與互助',
    url: 'missionrelay.html',
    active: true,
    color: '#CC7A00', // brand orange
    pos: [-1.5, 0.35, 1.5],
  },
  {
    id: 'eatingmap',
    name: '記憶地圖',
    zh: '食物・回憶 3D 地球',
    url: null,
    active: false,
    color: '#C2571F',
    pos: [-2.2, -0.25, 2.3],
  },
  {
    id: 'bodygravity',
    name: 'BodyGravity SN',
    zh: '身體準備',
    url: null,
    active: false,
    color: '#3E7C8C',
    pos: [-0.75, -0.35, 2.1],
  },
  {
    id: 'tripboard',
    name: 'TripBoard SN',
    zh: '遠行與行程',
    url: null,
    active: false,
    color: '#6B7FA3',
    pos: [0.75, -0.35, 2.1],
  },
  {
    id: 'knowledge',
    name: '知識探索',
    zh: 'Knowledge Cards / TubeList',
    url: null,
    active: false,
    color: '#8A6DA8',
    pos: [2.2, -0.25, 2.3],
  },
  {
    id: 'receipt',
    name: '單據夾 SN',
    zh: 'Receipt · 雲端驗證',
    url: 'receipt.html',
    active: true,
    color: '#A8836B',
    pos: [-0.85, 1.0, 3.1],
  },
  {
    id: 'nanahub',
    name: 'NanaHub',
    zh: '家與社群',
    url: null,
    active: false,
    color: '#C9A24B',
    pos: [0.85, 1.0, 3.1],
  },
];

function hexToVec3(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return `vec3f(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
}

function vec3List(tools) {
  return tools.map((t) => `vec3f(${t.pos.map((n) => n.toFixed(4)).join(', ')})`).join(',\n    ');
}

function colorList(tools) {
  return tools.map((t) => `    ${hexToVec3(t.color)}`).join(',\n');
}

/*
 * 產生 fullscreen raymarched WGSL。uniform 以 f32 純量對應 vgpu 的 set()，
 * 避免 vec3 陣列映射的反射歧義。節點位置／顏色以 compile-time 常數注入。
 */
export function buildShader(tools) {
  const count = tools.length;
  return /* wgsl */ `
struct Params {
  time: f32,
  aspect: f32,
  camX: f32, camY: f32, camZ: f32,
  lookX: f32, lookY: f32, lookZ: f32,
  hover: f32,
}
@group(0) @binding(0) var<uniform> params: Params;

const NODE_COUNT: u32 = ${count}u;
const NODE_RADIUS: f32 = ${NODE_RADIUS};
const TAN_HALF: f32 = ${TAN_HALF};
const MAX_DIST: f32 = 24.0;

const NODE_POS: array<vec3f, ${count}> = array<vec3f, ${count}>(
    ${vec3List(tools)}
);

const NODE_COL: array<vec3f, ${count}> = array<vec3f, ${count}>(
${colorList(tools)}
);

fn sdSphere(p: vec3f, r: f32) -> f32 {
  return length(p) - r;
}

fn map(p: vec3f) -> f32 {
  var d: f32 = p.y + 1.7;
  for (var i: u32 = 0u; i < NODE_COUNT; i = i + 1u) {
    let q = p - NODE_POS[i];
    d = min(d, sdSphere(q, NODE_RADIUS));
  }
  return d;
}

fn calcNormal(p: vec3f) -> vec3f {
  let e = vec3f(0.001, 0.0, 0.0);
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

  let bg = vec3f(0.914, 0.918, 0.906); /* #E9EAE7 淺色背景 */
  var col = bg;
  var t = 0.0;

  for (var s: i32 = 0; s < 96; s = s + 1) {
    let p = cam + dir * t;
    let d = map(p);
    if (d < 0.0012) {
      let n = calcNormal(p);
      let ndl = max(dot(n, normalize(vec3f(0.35, 0.8, 0.45))), 0.0);
      var nodeCol = vec3f(0.32, 0.36, 0.40);
      var glow = 0.0;
      for (var i: u32 = 0u; i < NODE_COUNT; i = i + 1u) {
        let q = p - NODE_POS[i];
        if (length(q) < NODE_RADIUS + 0.03) {
          nodeCol = NODE_COL[i];
          let pulse = 0.5 + 0.5 * sin(params.time * 1.6 + f32(i) * 1.9);
          glow = 0.18 + 0.14 * pulse;
          if (f32(i) == params.hover) {
            glow = glow + 0.45;
          }
          i = NODE_COUNT;
        }
      }
      col = nodeCol * (0.22 + 0.85 * ndl) + nodeCol * glow;
      let fog = 1.0 - exp(-0.16 * t);
      col = mix(col, bg, fog);
      break;
    }
    t = t + max(d, 0.0009);
    if (t > MAX_DIST) {
      break;
    }
  }

  let r2 = dot(ndc, ndc);
  col = col * (1.0 - 0.10 * r2);

  return vec4f(col, 1.0);
}
`;
}
