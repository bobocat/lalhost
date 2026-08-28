// Beach AR - main entry point
// Registers the image-target tracker, loads the locally generated image target,
// and shows/hides the "find image" prompt as the marker is found/lost.
import {imageTargetTrackerComponent} from './image-target-tracker.js'

// Defaults; overridden by config.json (image name/preview, model rotation/scale/position).
const DEFAULT_CONFIG = {
  image: {name: 'beach', displayImage: 'sourceimages/beach2.png', displayOpacity: 0.5, findText: 'Find the beach image'},
  model: {rotation: {x: 0, y: 0, z: 0}, scale: 1, position: {x: 0, y: 0, z: 0}},
}
let CONFIG = DEFAULT_CONFIG
let TARGET_NAME = DEFAULT_CONFIG.image.name

AFRAME.registerComponent('image-target-tracker', imageTargetTrackerComponent)

async function loadConfig() {
  try {
    const res = await fetch('config.json', {cache: 'no-store'})
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const cfg = await res.json()
    CONFIG = {
      image: {...DEFAULT_CONFIG.image, ...(cfg.image || {})},
      model: {...DEFAULT_CONFIG.model, ...(cfg.model || {})},
    }
  } catch (err) {
    console.warn('[beach-ar] config.json not loaded, using defaults:', err)
  }
  TARGET_NAME = CONFIG.image.name
}

const vec = (v, fallback) => {
  if (typeof v === 'string') return v
  const o = {...fallback, ...(v || {})}
  return `${o.x} ${o.y} ${o.z}`
}

// Apply model.rotation (degrees, x y z), model.scale, model.position from config.
function applyModelTransform() {
  const model = document.getElementById('beach')
  if (!model) return
  const m = CONFIG.model
  const s = typeof m.scale === 'number' ? `${m.scale} ${m.scale} ${m.scale}` : vec(m.scale, {x: 1, y: 1, z: 1})
  model.setAttribute('scale', s)
  model.setAttribute('rotation', vec(m.rotation, {x: 0, y: 0, z: 0}))
  model.setAttribute('position', vec(m.position, {x: 0, y: 0, z: 0}))
}

function applyImageConfig() {
  const img = CONFIG.image
  const textEl = document.getElementById('find-image-text')
  if (textEl && img.findText) textEl.textContent = img.findText
  const previewEl = document.getElementById('find-image-preview')
  if (previewEl) {
    if (img.displayImage) previewEl.src = img.displayImage
    if (img.displayOpacity != null) previewEl.style.opacity = String(img.displayOpacity)
  }
}

// Fetch the CLI-generated target JSON and hand it to the engine once XR8 exists.
async function configureImageTargets() {
  const TARGET_JSON = `image-targets/${TARGET_NAME}.json`
  let data
  try {
    const res = await fetch(TARGET_JSON, {cache: 'no-store'})
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    data = await res.json()
  } catch (err) {
    console.error(`[beach-ar] could not load ${TARGET_JSON} — run "npx @8thwall/image-target-cli@latest" (see README):`, err)
    return
  }

  const apply = () => {
    if (!window.XR8 || !window.XR8.XrController) {
      console.error('[beach-ar] XR8.XrController unavailable (is the "slam" chunk preloaded?)')
      return
    }
    window.XR8.XrController.configure({imageTargetData: [data]})
    console.log(`[beach-ar] XrController.configure OK [${data.name}]`)
  }

  if (window.XR8) apply()
  else window.addEventListener('xrloaded', apply)
}

function wireOverlay() {
  const target = document.getElementById('image-target')
  const findScreen = document.getElementById('find-image-screen')
  if (!target || !findScreen) return
  target.addEventListener('image-target-found', () => findScreen.classList.add('hidden'))
  target.addEventListener('image-target-lost', () => findScreen.classList.remove('hidden'))
}

// Desktop preview: place the container in front of the camera and fire the found event.
function setupSimulateMode() {
  const btn = document.getElementById('fake-place-btn')
  const target = document.getElementById('image-target')
  if (!btn || !target) return
  btn.classList.remove('hidden')
  btn.addEventListener('click', () => {
    const o = target.object3D
    o.position.set(0, -0.5, -3)
    o.quaternion.set(0, 0, 0, 1)
    o.scale.setScalar(1)
    o.visible = true
    target.emit('image-target-found', {name: TARGET_NAME, simulated: true})
  })
}

async function init() {
  await loadConfig()
  const target = document.getElementById('image-target')
  if (target) target.setAttribute('image-target-tracker', 'name', TARGET_NAME)
  applyImageConfig()
  applyModelTransform()
  wireOverlay()

  if (window.__SIMULATE_AR__) {
    console.log('[beach-ar] simulate mode')
    setupSimulateMode()
  } else {
    configureImageTargets()
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
