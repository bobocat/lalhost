// store.js — config.json (machine defaults, edited by hand) and localStorage
// (calibration and settings, written by the app). Versioned keys, per CLAUDE.md.

export const CAL_KEY = 'windowview.calibration.v1';
export const SET_KEY = 'windowview.settings.v1';
export const GAME_KEY = 'windowview.game.v1';      // Head Dodge: reach, sound, best score, neutral face

export const defaultConfig = () => ({
  screen: { diagonalInches: 15.6 },          // pre-filled on the calibration screen
  camera: {
    width: 640, height: 480,                 // capture resolution requested from getUserMedia
    position: 'top-centre',                  // top-centre | top-left | top-right | custom
    customCm: { x: 0, y: 12, z: 0 },         // used when position is 'custom'; relative to display centre
  },
  ipdMm: 63,                                 // adult average; overridable during calibration
  scene: {
    glb: 'assets/scene.glb',                 // swap this file (or this path) for another scene
    aimAtViewer: true,                       // tilt the room to face where you sit; false hangs it square on the screen
  },
  filter: { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0, extrapolateMs: 50 },
  parallaxGain: 1.0,
  preview: { show: true, width: 220 },
});

export const num = (v, d, min = -Infinity, max = Infinity) =>
  (Number.isFinite(+v) && +v >= min && +v <= max ? +v : d);

let CFG = defaultConfig();
let configStatus = 'config.json not read yet';

export const cfg = () => CFG;
export const cfgStatus = () => configStatus;

export async function loadConfig() {
  let raw = null;
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (r.ok) { raw = await r.json(); configStatus = 'config.json loaded'; }
    else configStatus = `config.json: HTTP ${r.status} — using built-in defaults`;
  } catch (e) {
    configStatus = location.protocol === 'file:'
      ? 'config.json is ignored when index.html is opened directly — run play.cmd (or serve the folder) to use it'
      : `config.json not read (${e.message}) — using built-in defaults`;
  }
  if (!raw) console.warn(configStatus);
  if (raw && typeof raw === 'object') deepAssign(CFG, raw);
  return CFG;
}

function deepAssign(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepAssign(target[k], v);
    else target[k] = v;
  }
}

// ---- localStorage -----------------------------------------------------------
function read(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; }
  catch (e) { console.warn('localStorage read failed', e); return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('localStorage write failed', e); return false; }
}

export const loadCalibration = () => read(CAL_KEY);
export const saveCalibration = (c) => write(CAL_KEY, c);
export const clearCalibration = () => { try { localStorage.removeItem(CAL_KEY); } catch (e) { /* ignore */ } };

const ANCHOR_NAMES = { glass: 0, room: 0.5, back: 1 };   // the first build stored these as words

export function loadSettings() {
  const c = CFG;
  const s = Object.assign({
    gain: c.parallaxGain,
    anchor: 1,                               // 0 = glass (exact window) … 1 = back wall: which depth holds still, DESIGN §2.6
    imageDepthCm: -30,                       // where the picture plane sits behind the glass (RESEARCH §4d)
    wiggleRangeCm: 8,                        // head travel that sweeps a wigglegram from its leftmost to its rightmost view
    autoWiggle: false,                       // ping-pong the views like a GIF instead of scrubbing with the head
    minCutoff: c.filter.minCutoff,
    beta: c.filter.beta,
    extrapolateMs: c.filter.extrapolateMs,
    previewOn: c.preview.show,
    previewWidth: c.preview.width,
    debugOn: false,
  }, read(SET_KEY) || {});
  if (typeof s.anchor === 'string') s.anchor = ANCHOR_NAMES[s.anchor] ?? 1;
  s.anchor = Math.max(0, Math.min(1, +s.anchor || 0));
  return s;
}
export const saveSettings = (s) => write(SET_KEY, s);

export function loadGameSettings() {
  const g = (CFG.game && CFG.game.settings) || {};
  return Object.assign({ reach: 1.5, sound: true, best: 0, neutral: null, debugOn: false, previewOn: true },
    g, read(GAME_KEY) || {});
}
export const saveGameSettings = (s) => write(GAME_KEY, s);

// A calibration is stale if the capture or the screen resolution has changed since it was made.
export function calibrationStale(cal) {
  if (!cal) return null;
  const dpr = window.devicePixelRatio || 1;
  if (cal.screenW && (cal.screenW !== screen.width || cal.screenH !== screen.height))
    return 'the screen resolution changed since you calibrated';
  if (cal.dpr && Math.abs(cal.dpr - dpr) > 0.01)
    return 'the browser zoom or display scaling changed since you calibrated';
  return null;
}
