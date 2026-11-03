/* NESTIR hero — WebGPU 冷灰白大理石背景（Shaders 4.0.6）
 *
 * 漸進增强：冇 WebGPU／冇 adapter／用戶要求減少動態 → 乜都唔做，保留原本 CSS 漸層。
 * 任何錯誤 → 移除 canvas，靜態設計照舊。
 * ponytail: 直接載 prebuilt ESM bundle（本身標明 no bundler required），唔加 build step。
 */
import { createShader } from '../assets/vendor/shaders-4.0.6.bundle.js'

const host = document.querySelector('.site-hero__scene')
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// SN 冷灰白大理石：底漸層 → 大理石 → 冷調極光 → 細點 → 輕玻璃紋
const components = [
  { type: 'LinearGradient', props: { colorA: '#ffffff', colorB: '#e6eaee', angle: 165, colorSpace: 'oklch' } },
  { type: 'Marble', props: { colorA: '#ffffff', colorB: '#ccd6dd', colorC: '#a8b4bf', scale: 3.0, turbulence: 10, speed: 0.05, seed: 7, opacity: 0.5 } },
  { type: 'Aurora', props: { colorA: '#dbe6ee', colorB: '#c2d2de', colorC: '#f2f5f7', intensity: 24, speed: 2, height: 55, curtainCount: 3, waviness: 70, rayDensity: 12, opacity: 0.35, blendMode: 'softLight' } },
  { type: 'DotGrid', props: { color: '#96a3ae', density: 170, dotSize: 0.18, offset: 0.35, speed: 0.2, twinkle: 0.4, opacity: 0.32 } },
  { type: 'FlutedGlass', props: { shape: 'bars', frequency: 16, softness: 0.8, waveAmplitude: 0.04, speed: 0.12, aberration: 0.05, highlight: 0.1, opacity: 0.35 } },
]

async function mount() {
  if (!host || !navigator.gpu || reduced) return

  // ponytail: navigator.gpu 存在 ≠ 有 adapter（GPU blocklist／headless 會 fail）→ 先探一次。
  let adapter = null
  try { adapter = await navigator.gpu.requestAdapter() } catch { adapter = null }
  if (!adapter) return

  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  host.appendChild(canvas)
  host.classList.add('has-shader')

  try {
    await createShader(canvas, { components })
    host.classList.add('shader-ready')
  } catch (err) {
    console.warn('[hero-shader] fallback to static gradient:', err)
    canvas.remove()
    host.classList.remove('has-shader', 'shader-ready')
  }
}

mount()
