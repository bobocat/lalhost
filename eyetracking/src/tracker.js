// tracker.js — MediaPipe FaceLandmarker in VIDEO mode. Ported from Face Pilot and
// trimmed to what Window View needs: the two iris centres, the head yaw, and timings.

const MP_VERSION = '1.0.1';                 // fallback pin if this misbehaves: 0.10.35 (docs/DESIGN.md §5)
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_WASM = `${MP_CDN}/wasm`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const LOAD_TIMEOUT_MS = 15000;
const FACE_LOST_MS = 400;

export const IRIS_L = 468;                  // iris centres in the 478-point mesh
export const IRIS_R = 473;

/**
 * The facial transformation matrix arrives as 16 numbers whose layout the docs do not
 * pin down, so detect it: a rotation matrix has (0,0,0,1) in the slot the translation
 * is *not* in, and the translation is tens of centimetres. Yaw is read accordingly.
 * Only cos(yaw) is used downstream, so a sign error there is harmless; it is displayed
 * in the debug panel to be checked by eye.
 */
export function decodeMatrix(m) {
  if (!m || m.length < 16) return null;
  const colMajor = Math.abs(m[12]) + Math.abs(m[13]) + Math.abs(m[14]);
  const rowMajor = Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]);
  const col = colMajor >= rowMajor;
  const t = col ? [m[12], m[13], m[14]] : [m[3], m[7], m[11]];
  // r13 / r33 of the rotation part: index 8 / 10 column-major, 2 / 10 row-major.
  const r13 = col ? m[8] : m[2];
  const r33 = m[10];
  const r23 = col ? m[9] : m[6];
  return {
    layout: col ? 'column-major' : 'row-major',
    tx: t[0], ty: t[1], tz: t[2],
    yaw: Math.atan2(r13, r33),
    pitch: Math.asin(Math.max(-1, Math.min(1, -r23))),
  };
}

export class Tracker {
  constructor() {
    this.ready = false;
    this.landmarker = null;
    this.error = null;
    this.faceFound = false;
    this.lastSeen = 0;
    this.landmarks = null;
    this.matrix = null;          // decoded, see decodeMatrix
    this.delegate = '';
    this.inferMs = 0;
    this.fps = 0;
    this.result = null;          // {u, v, ipdPx, yaw} in capture pixels — the M1 raw readout
    this.blendshapes = null;     // {categoryName: score} when loaded with blendshapes: true
    this.captureWidth = 0;       // frame size the samples above are expressed in
    this.captureHeight = 0;
    this._frames = 0;
    this._fpsT = 0;
    this._lastStamp = 0;
  }

  /** @param blendshapes  also output the 52 blendshape scores (the game needs them; the viewer does not) */
  async load({ blendshapes = false } = {}) {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('timed out after 15 s')), LOAD_TIMEOUT_MS));
    let mod;
    try {
      mod = await Promise.race([import(/* @vite-ignore */ MP_CDN), timeout]);
      const vision = await Promise.race([mod.FilesetResolver.forVisionTasks(MP_WASM), timeout]);
      const make = (delegate) => mod.FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: blendshapes,
        outputFacialTransformationMatrixes: true,
      });
      try {
        this.landmarker = await Promise.race([make('GPU'), timeout]);
        this.delegate = 'GPU';
      } catch (e) {
        console.warn('GPU delegate failed, falling back to CPU', e);
        this.landmarker = await make('CPU');
        this.delegate = 'CPU';
      }
    } catch (e) {
      this.error = "Couldn't load face tracking — check your connection. (" + (e.message || e) + ')';
      throw new Error(this.error);
    }
    this.ready = true;
    return this.delegate;
  }

  /** Run one detection on the current video frame. Returns the raw readout or null. */
  detect(video) {
    if (!this.ready) return null;
    const t0 = performance.now();
    // detectForVideo insists on strictly increasing timestamps
    const stamp = Math.max(t0, this._lastStamp + 0.1);
    this._lastStamp = stamp;
    let res;
    try { res = this.landmarker.detectForVideo(video, stamp); }
    catch (e) { console.warn('detectForVideo failed', e); return null; }

    this.inferMs = this.inferMs * 0.9 + (performance.now() - t0) * 0.1;
    this._frames++;
    if (t0 - this._fpsT > 1000) { this.fps = this._frames; this._frames = 0; this._fpsT = t0; }

    const lms = res.faceLandmarks && res.faceLandmarks[0];
    if (!lms || lms.length <= IRIS_R) {
      if (t0 - this.lastSeen > FACE_LOST_MS) { this.faceFound = false; this.landmarks = null; this.result = null; }
      return null;
    }
    this.faceFound = true;
    this.lastSeen = t0;
    this.landmarks = lms;
    if (res.faceBlendshapes && res.faceBlendshapes[0]) {
      const bs = {};
      for (const c of res.faceBlendshapes[0].categories) bs[c.categoryName] = c.score;
      this.blendshapes = bs;
    }
    this.matrix = decodeMatrix(res.facialTransformationMatrixes && res.facialTransformationMatrixes[0]
      ? res.facialTransformationMatrixes[0].data : null);

    const w = video.videoWidth, h = video.videoHeight;
    this.captureWidth = w; this.captureHeight = h;
    const a = lms[IRIS_L], b = lms[IRIS_R];
    const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
    this.result = {
      u: (ax + bx) / 2,
      v: (ay + by) / 2,
      ipdPx: Math.hypot(bx - ax, by - ay),
      yaw: this.matrix ? this.matrix.yaw : landmarkYaw(lms),
      yawSource: this.matrix ? 'matrix' : 'landmarks',
      t: t0,
    };
    return this.result;
  }

  /** Face considered lost after FACE_LOST_MS without a detection. */
  lost(now = performance.now()) {
    return !this.faceFound || (now - this.lastSeen) > FACE_LOST_MS;
  }
}

// Geometric yaw proxy (Face Pilot's), used only if the transformation matrix is missing.
function landmarkYaw(lm) {
  const l = lm[234], r = lm[454], n = lm[1];
  if (!l || !r || !n) return 0;
  const k = ((n.x - (l.x + r.x) / 2) / Math.max(1e-3, (r.x - l.x))) * 2;
  return Math.atan(k);           // rough, but only cos() of it is used
}
