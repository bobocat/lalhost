// Image Target Tracker Component
//
// A reusable base for 8th Wall image-target ("filter") experiences on the
// open-source / console-less engine. Attach it to the entity that should ride a
// tracked image marker. It poses that entity from the raw 8th Wall image events
// and re-emits them as friendly A-Frame events you can build on.
//
// IMPORTANT: Do NOT also use `xrextras-named-image-target`. That component
// re-configures image targets by name the legacy (console) way and clears the
// locally bundled `imageTargetData`, so the engine stops detecting. This
// component reads the raw events instead and makes no configure() calls.
//
// Setup (see also library/utils/image-targets.js for engine configuration):
//   import { imageTargetTrackerComponent } from '../../library/components/image-target-tracker/image-target-tracker.js'
//   AFRAME.registerComponent('image-target-tracker', imageTargetTrackerComponent)
//
//   <a-scene xrweb="allowedDevices: any; disableWorldTracking: true">
//     <a-entity id="marker" image-target-tracker="name: my-target">
//       <!-- content here is positioned relative to the marker -->
//     </a-entity>
//   </a-scene>
//
// Schema:
//   name          - image target name to track (matches the `name` in the target
//                   JSON). Empty string tracks ANY detected target.
//   hideWhenLost  - hide the entity while the marker is out of view (default true).
//                   Forced off while `worldLock` is on.
//   smoothing     - per-frame pose easing toward the latest engine update. 0 = snap
//                   (default, original behavior); 0..1 = fraction of the remaining
//                   error closed each 60fps frame (frame-rate independent). Higher =
//                   snappier, lower = smoother/laggier. De-jitters live tracking.
//   worldLock     - persist the entity in world space when the marker is lost
//                   instead of hiding it. Requires the scene to run with world
//                   tracking ON (xrweb disableWorldTracking:false) so SLAM keeps the
//                   container — already a child of <a-scene>, i.e. world space —
//                   anchored. Re-detections continuously re-correct the pose.
//   minConfidence - ignore re-corrections whose confidence is below this (0..1).
//                   Only applies once an initial pose exists. 0 = accept everything.
//
// Emits on this.el (bubbles, so scene-level components can listen too):
//   'image-target-found'   { name, intersection, hz, ageMs, jitter, confidence, confidenceIsProxy, locked }
//   'image-target-updated' { ...same... }
//   'image-target-lost'    { ...same... }
//
// The extra fields are live tracking metrics for debug HUDs:
//   hz               - measured engine update rate (updates/sec)
//   ageMs            - time since the last accepted engine update
//   jitter           - distance (m) the target moved on the last update
//   confidence       - 0..1; the engine's value if it exposes one, else a derived
//                      proxy from jitter (see confidenceIsProxy)
//   confidenceIsProxy- true when `confidence` is the jitter-derived proxy (the
//                      open-source engine did not expose a confidence field)
//   locked           - whether worldLock is active

// Jitter (m) at/above which the derived proxy confidence reads 0.
const JITTER_REF = 0.02

export const imageTargetTrackerComponent = {
  schema: {
    name: {type: 'string', default: ''},
    hideWhenLost: {type: 'boolean', default: true},
    smoothing: {type: 'number', default: 0},
    worldLock: {type: 'boolean', default: false},
    minConfidence: {type: 'number', default: 0},
  },

  init() {
    this.sceneEl = this.el.sceneEl
    this.isVisible = false
    this.hasPose = false
    this.snapNext = false

    // Latest engine-reported target pose; eased into object3D each frame in tick().
    this.targetPos = new THREE.Vector3()
    this.targetQuat = new THREE.Quaternion()
    this.targetScale = 1
    this._prevPos = new THREE.Vector3()
    this._tmp = new THREE.Vector3()

    // Live tracking metrics surfaced on the emitted events / for a debug HUD.
    this.lastUpdateTime = 0
    this.stats = {hz: 0, ageMs: 0, jitter: 0, confidence: 0, confidenceIsProxy: false}

    if (this.data.hideWhenLost && !this.data.worldLock) this.el.object3D.visible = false

    this.onFound = this.onFound.bind(this)
    this.onUpdated = this.onUpdated.bind(this)
    this.onLost = this.onLost.bind(this)

    this.sceneEl.addEventListener('xrimagefound', this.onFound)
    this.sceneEl.addEventListener('xrimageupdated', this.onUpdated)
    this.sceneEl.addEventListener('xrimagelost', this.onLost)
  },

  matches(detail) {
    // Track the configured target only; empty name tracks any detected target.
    return !this.data.name || !detail || !detail.name || detail.name === this.data.name
  },

  // Pull a confidence value (0..1) from the engine detail if it exposes one.
  // The open-source engine may not — callers fall back to a jitter-derived proxy.
  readConfidence(detail) {
    if (!detail) return null
    if (typeof detail.confidence === 'number') return detail.confidence
    if (typeof detail.score === 'number') return detail.score
    if (typeof detail.quality === 'number') return detail.quality
    return null
  },

  // Stash the latest engine pose + metrics. Returns false when the update is
  // rejected (below minConfidence) so the previous pose is held.
  updateTarget(detail) {
    if (!detail) return false

    // Jitter: how far the reported position moved vs the last accepted one.
    let jitter = 0
    if (this.hasPose && detail.position) {
      jitter = this._prevPos.distanceTo(
        this._tmp.set(detail.position.x, detail.position.y, detail.position.z))
    }

    const raw = this.readConfidence(detail)
    const confidence = raw != null ? raw : Math.max(0, 1 - jitter / JITTER_REF)
    this.stats.confidenceIsProxy = raw == null
    this.stats.confidence = confidence

    // Gate re-corrections (not the first acquisition) below minConfidence.
    if (this.hasPose && this.data.minConfidence > 0 && confidence < this.data.minConfidence) {
      return false
    }

    const first = !this.hasPose
    if (detail.position) {
      this.targetPos.set(detail.position.x, detail.position.y, detail.position.z)
      this._prevPos.copy(this.targetPos)
    }
    if (detail.rotation) {
      this.targetQuat.set(detail.rotation.x, detail.rotation.y, detail.rotation.z, detail.rotation.w)
    }
    if (typeof detail.scale === 'number') this.targetScale = detail.scale

    const now = performance.now()
    if (this.lastUpdateTime) {
      const dt = now - this.lastUpdateTime
      if (dt > 0) this.stats.hz = 1000 / dt
    }
    this.lastUpdateTime = now
    this.stats.jitter = jitter

    if (first) this.snapNext = true  // place instantly on first acquisition (no fly-in)
    this.hasPose = true
    return true
  },

  // Fraction of remaining error to close this frame, frame-rate independent.
  smoothingFactor(dt) {
    const s = this.data.smoothing
    if (!s || s <= 0) return 1
    if (s >= 1) return 1
    const frames = (dt || 16.67) / 16.67
    return 1 - Math.pow(1 - s, frames)
  },

  tick(time, dt) {
    if (!this.hasPose) return
    const o = this.el.object3D
    const k = this.snapNext ? 1 : this.smoothingFactor(dt)
    this.snapNext = false

    if (k >= 1) {
      o.position.copy(this.targetPos)
      o.quaternion.copy(this.targetQuat)
      o.scale.setScalar(this.targetScale)
    } else {
      o.position.lerp(this.targetPos, k)
      o.quaternion.slerp(this.targetQuat, k)
      o.scale.setScalar(o.scale.x + (this.targetScale - o.scale.x) * k)
    }

    this.stats.ageMs = performance.now() - this.lastUpdateTime
  },

  emitWithStats(eventName, detail) {
    this.el.emit(eventName, {
      name: detail && detail.name,
      intersection: detail,
      hz: this.stats.hz,
      ageMs: this.stats.ageMs,
      jitter: this.stats.jitter,
      confidence: this.stats.confidence,
      confidenceIsProxy: this.stats.confidenceIsProxy,
      locked: this.data.worldLock,
    })
  },

  onFound(event) {
    if (!this.matches(event.detail)) return
    this.updateTarget(event.detail)
    this.el.object3D.visible = true
    this.isVisible = true
    this.emitWithStats('image-target-found', event.detail)
  },

  onUpdated(event) {
    if (!this.matches(event.detail)) return
    this.updateTarget(event.detail)
    this.el.object3D.visible = true
    this.isVisible = true
    this.emitWithStats('image-target-updated', event.detail)
  },

  onLost(event) {
    if (!this.matches(event.detail)) return
    this.isVisible = false
    // worldLock keeps the entity in place (SLAM holds the world-space container);
    // otherwise hide it while the marker is out of view.
    if (this.data.hideWhenLost && !this.data.worldLock) {
      this.el.object3D.visible = false
    }
    this.emitWithStats('image-target-lost', event.detail)
  },

  remove() {
    this.sceneEl.removeEventListener('xrimagefound', this.onFound)
    this.sceneEl.removeEventListener('xrimageupdated', this.onUpdated)
    this.sceneEl.removeEventListener('xrimagelost', this.onLost)
  },
}
