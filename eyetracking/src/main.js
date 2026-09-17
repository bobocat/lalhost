// main.js — wiring and the render loop.
//
// Per frame: run the tracker if the webcam produced a new frame, convert that sample to
// a head position in centimetres, feed the One Euro filter, read the filtered position
// back (extrapolated to now), point an off-axis frustum at the screen corners from
// there, and draw. Everything else on this page is scaffolding around that loop.

import * as THREE from 'three';
import {
  loadConfig, cfg, cfgStatus, loadCalibration, saveCalibration,
  loadSettings, saveSettings, calibrationStale,
} from './store.js';
import { Camera } from './camera.js';
import { Tracker } from './tracker.js';
import { headPose } from './headpose.js';
import { HeadFilter } from './filter.js';
import { ScreenGeometry, toggleFullscreen } from './screen.js';
import { applyOffAxis, anchorShift } from './projection.js';
import { Scene3D } from './scene3d.js';
import { Calibration } from './calibrate.js';
import { $, showScreen, showError, toast, setLost, bindActions, Preview, setHud } from './ui.js';
import { debugPanel } from './debug.js';
import { WiggleStrip } from './wiggle.js';

const app = {
  mode: 'title',            // title | cal | view | error
  content: 'scene',         // scene | image (a wigglegram strip on a plane behind the glass)
  source: 'camera',         // camera | manual
  cal: null,
  settings: null,
  rawPose: { x: 0, y: 0, z: 60 },
  restEye: { x: 0, y: 0, z: 50 },
  anchor: { mode: 1, depth: 0, t: 1, shift: { x: 0, y: 0 } },
  eye: { x: 0, y: 0, z: 60 },
  camPos: { x: 0, y: 12, z: 0 },
  poseState: {},            // carries lastZ for the yaw freeze
  latencyMs: 0,
  renderFps: 0,
  renderMs: 0,
  lost: false,
};

const canvas = $('view');
const video = $('video');
const camera = new Camera(video);
const tracker = new Tracker();
const filter = new HeadFilter();
const scene3d = new Scene3D();
const wiggle = new WiggleStrip(scene3d.scene);
const preview = new Preview($('preview'), video);
let screenGeom, renderer, cam3d, calWizard;
let trackingStarting = null;

const ANCHOR_PRESETS = [0, 0.5, 1];          // V jumps between these; N / M step by 0.1
const anchorLabel = (a) => (a <= 0 ? 'glass' : a >= 1 ? 'back wall' : `${Math.round(a * 100)}% deep`);

// manual (no-camera) head position, moved with the mouse and the arrow keys
const manual = { x: 0, y: 0, z: 55 };

Object.assign(app, { tracker, filter, scene3d, camera });

// ---------------------------------------------------------------- boot
(async function boot() {
  await loadConfig();
  const c = cfg();
  app.settings = loadSettings();

  const status = $('cfgStatus');
  status.hidden = cfgStatus() === 'config.json loaded';
  status.textContent = cfgStatus();

  app.cal = loadCalibration();
  screenGeom = new ScreenGeometry(canvas, app.cal ? app.cal.diagonalInches : c.screen.diagonalInches);
  app.screenGeom = screenGeom;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x05070c, 1);
  cam3d = new THREE.PerspectiveCamera(60, 1, 1, 1000);
  onResize();

  scene3d.aimEnabled = c.scene.aimAtViewer !== false;
  await scene3d.load(c.scene.glb);

  calWizard = new Calibration({
    screenGeom, tracker, cfg: c,
    onLive: () => (app.source === 'manual' || !tracker.lost() ? app.eye : null),
    onDone: (cal) => {
      app.cal = cal;
      saveCalibration(cal);
      app.settings.gain = cal.gain;
      saveSettings(app.settings);
      screenGeom.setDiagonalInches(cal.diagonalInches);
      filter.reset();
      enterViewer();
      toast('Calibration saved');
    },
    onCancel: () => { app.mode = 'title'; showScreen('s-title'); refreshTitle(); },
  });

  bindActions({
    start: () => start(),
    calibrate: () => calibrate(),
    keyboard: () => { app.source = 'manual'; enterViewer(); },
    retry: () => start(),
    'cal-next1': () => calWizard.next1(),
    'cal-capture': () => calWizard.capture(),
    'cal-back2': () => calWizard.back(1),
    'cal-back3': () => calWizard.back(2),
    'cal-save': () => calWizard.save(),
    'cal-cancel': () => calWizard.cancel(),
  });

  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', () => { onResize(); refreshHud(); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('mousemove', onMouse);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) openWiggle(e.dataTransfer.files[0]); });

  preview.setWidth(app.settings.previewWidth);
  filter.setParams(app.settings);
  filter.extrapolateMs = app.settings.extrapolateMs;

  refreshTitle();
  showScreen('s-title');
  requestAnimationFrame(loop);

  window.WV = app;   // debug handle, as in Face Pilot
  console.log('Window View ready ·', scene3d.describe());

  // URL flags, separated by ';'. #manual opens the viewer straight away with
  // keyboard/mouse head control and no camera, so the renderer can be checked on a
  // machine without a webcam; #calibrate goes straight to the wizard; #debug opens the
  // panel.
  const flags = new Set((location.hash || '').slice(1).split(';'));
  if (flags.has('debug')) { app.settings.debugOn = true; }
  for (const f of flags) {
    if (!f.startsWith('anchor=')) continue;
    const v = { glass: 0, room: 0.5, back: 1 }[f.slice(7)] ?? +f.slice(7);
    if (Number.isFinite(v)) app.settings.anchor = Math.max(0, Math.min(1, v));
  }
  if (flags.has('manual')) { app.source = 'manual'; enterViewer(); }
  if (flags.has('calibrate')) calibrate();
  for (const f of flags) if (f.startsWith('wiggle=')) openWiggle(f.slice(7));
  // #manual;eye=-12,0,50 pins the head, so two screenshots at two positions check the
  // parallax without a webcam.
  for (const f of flags) {
    if (!f.startsWith('eye=')) continue;
    const [x, y, z] = f.slice(4).split(',').map(Number);
    if ([x, y, z].every(Number.isFinite)) { manual.x = x; manual.y = y; manual.z = z; manual.pinned = true; }
  }
})();

function refreshTitle() {
  const stale = calibrationStale(app.cal);
  $('calState').innerHTML = app.cal
    ? `Calibrated ${new Date(app.cal.savedAt).toLocaleDateString()}: ${app.cal.diagonalInches}" screen, ` +
      `f ${app.cal.fPx.toFixed(0)} px, eye spacing ${app.cal.ipdMm} mm.` +
      (stale ? ` <span class="warn">Recalibrate — ${stale}.</span>` : '')
    : 'Not calibrated yet — the first run takes about a minute.';
  $('s-title').querySelector('[data-act="start"]').textContent = app.cal ? 'Start' : 'Calibrate and start';
}

// ---------------------------------------------------------------- flow
async function ensureTracking() {
  if (tracker.ready && camera.running) return true;
  if (trackingStarting) return trackingStarting;
  trackingStarting = (async () => {
    try {
      const c = cfg();
      toast('Starting the camera…', 2000);
      await camera.start(c.camera);
      toast('Loading the face model…', 4000);
      const delegate = await tracker.load();
      app.source = 'camera';
      toast(`Tracking on ${delegate}`, 1500);
      return true;
    } catch (e) {
      showError((e.message || String(e)) +
        ' — you can still try the view with keyboard and mouse control.');
      app.mode = 'error';
      return false;
    } finally { trackingStarting = null; }
  })();
  return trackingStarting;
}

async function start() {
  if (!app.cal) return calibrate();
  if (!await ensureTracking()) return;
  enterViewer();
}

function calibrate() {
  // Step 1 asks for the screen size, which needs no camera, so open it at once and let
  // the webcam and the face model warm up behind it — by step 2 they are usually ready.
  app.mode = 'cal';
  app.source = 'camera';
  filter.reset();
  calWizard.start(app.cal);
  ensureTracking().then((ok) => { if (ok && app.mode === 'cal') preview.setVisible(true); });
}

function enterViewer() {
  app.mode = 'view';
  showScreen(null);
  preview.setVisible(app.settings.previewOn && app.source === 'camera');
  $('debug').classList.toggle('hidden', !app.settings.debugOn);
  onResize();
  refreshHud();
  if (!screenGeom.fullscreen) toast('Press F for fullscreen — the geometry is only exact there', 2600);
}

function toTitle() {
  app.mode = 'title';
  setLost(false);
  showScreen('s-title');
  refreshTitle();
}

// ---------------------------------------------------------------- per-frame work
function onResize() {
  screenGeom.update();
  const r = canvas.getBoundingClientRect();
  renderer.setPixelRatio(screenGeom.dpr);
  renderer.setSize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)), false);
  cam3d.aspect = r.width / Math.max(1, r.height);    // only feeds frameCorners' fov estimate
}

// While the wizard is open the draft is the live calibration — that is what makes step 3
// a real check rather than a preview of the previous settings.
function activeCal() {
  if (app.mode === 'cal' && calWizard && calWizard.draft) return calWizard.draft;
  return app.cal;
}

/**
 * Where the viewer's eyes rest, in screen space. Calibration measures it; without one,
 * assume eyes level with the webcam at the calibrated distance, which is the common case
 * for a monitor sitting below eye level. The scene is aimed at this point — see
 * Scene3D.aim() for why it is the resting position and never the live one.
 */
function restingEye(cal) {
  const rel = (cal && cal.restRel) || { x: 0, y: 0, z: (cal && cal.distanceCm) || 50 };
  return { x: app.camPos.x + rel.x, y: app.camPos.y + rel.y, z: Math.max(20, rel.z) };
}

function sampleHead(now) {
  const c = cfg();
  const cal = activeCal();
  const preset = cal ? cal.camPreset : c.camera.position;
  const custom = cal ? cal.camCustom : c.camera.customCm;
  app.camPos = screenGeom.cameraPosition(preset, custom);
  app.restEye = restingEye(cal);
  scene3d.aim(app.restEye);

  if (app.source === 'manual') {
    app.rawPose = { x: manual.x, y: manual.y, z: manual.z };
    filter.update(app.rawPose, now);
    app.lost = false;
    return;
  }

  if (camera.running && tracker.ready && camera.hasNewFrame()) {
    const sample = tracker.detect(video);
    if (sample && cal && cal.fPx) {
      const pose = headPose(sample, { width: tracker.captureWidth, height: tracker.captureHeight },
        cal, app.camPos, app.poseState);
      app.rawPose = pose;
      filter.update(pose, sample.t);
    }
    app.latencyMs = now - camera.frameTime;
  }
  app.lost = tracker.lost(now);
}

function loop(now) {
  requestAnimationFrame(loop);
  const t0 = performance.now();

  sampleHead(now);

  // Face lost: freeze on the last filtered position rather than extrapolating into the void.
  const e = (app.lost && app.source === 'camera') ? filter.value : filter.at(now);
  app.eye = e;

  const gain = app.settings.gain;
  const eye = { x: e.x * gain, y: e.y * gain, z: e.z };
  // Anchor plane: slide the virtual screen so the chosen depth holds still as the head
  // moves away from where it rests. Gain is applied to the rest point too, so that at rest
  // the shift is exactly zero whatever the gain.
  const imageMode = app.content === 'image' && wiggle.loaded;
  scene3d.room.visible = !imageMode;
  scene3d.glass.visible = !imageMode;
  if (wiggle.mesh) wiggle.mesh.visible = imageMode;
  if (imageMode) {
    const D = app.settings.imageDepthCm;
    wiggle.place(D, screenGeom.rect(), app.restEye);
    if (app.settings.autoWiggle) wiggle.autoplay(now, 3);
    else app.wiggleIndex = wiggle.scrub(eye.x - app.restEye.x * gain, app.settings.wiggleRangeCm);
  }
  // the picture plane is pinned to the screen: the parallax is in the frames, not the plane
  const mode = imageMode ? 'image' : app.settings.anchor;
  const depth = imageMode ? app.settings.imageDepthCm : scene3d.anchorDepth(mode);
  const d = { x: eye.x - app.restEye.x * gain, y: eye.y - app.restEye.y * gain };
  const shift = anchorShift(d, eye.z, depth);
  app.anchor = { mode, depth, t: shift.t, shift };
  applyOffAxis(cam3d, eye, screenGeom.rect(), null, shift);
  renderer.render(scene3d.scene, cam3d);

  if (app.mode === 'cal') calWizard.tick(now);
  setLost(app.mode === 'view' && app.source === 'camera' && app.lost);
  preview.draw(tracker.landmarks, tracker.faceFound);

  app.renderMs = app.renderMs * 0.9 + (performance.now() - t0) * 0.1;
  frameCount++;
  if (!fpsT) fpsT = now;
  else if (now - fpsT > 1000) { app.renderFps = frameCount; frameCount = 0; fpsT = now; }
  if (app.settings.debugOn) $('debug').innerHTML = debugPanel(app);
  if (app.mode === 'view' && now - hudT > 250) { refreshHud(); hudT = now; }
}
let frameCount = 0, fpsT = 0, hudT = 0;

function refreshHud() {
  const s = app.settings;
  setHud(
    `<span class="kbd">F</span> fullscreen · <span class="kbd">C</span> preview · ` +
    `<span class="kbd">D</span> debug · <span class="kbd">K</span> keyboard · ` +
    `<span class="kbd">[</span><span class="kbd">]</span> gain ${s.gain.toFixed(2)} · ` +
    `<span class="kbd">V</span><span class="kbd">N</span><span class="kbd">M</span> anchor ${anchorLabel(s.anchor)} · ` +
    `<span class="kbd">R</span> recalibrate · <span class="kbd">Esc</span> menu<br>` +
    `${screenGeom.describe()} · you are ${app.eye.z.toFixed(0)} cm away · ` +
    (app.source === 'manual' ? 'keyboard control' : `${tracker.fps} fps tracking`) +
    (app.content === 'image' && wiggle.loaded
      ? `<br><span class="kbd">1</span> room · <span class="kbd">2</span> picture · <span class="kbd">O</span> open · ` +
        `<span class="kbd">W</span> ${app.settings.autoWiggle ? 'auto-wiggle' : 'head scrubs'} · ` +
        `<span class="kbd">&lt;</span><span class="kbd">&gt;</span> range ${app.settings.wiggleRangeCm} cm · ` +
        `${wiggle.name} · view ${wiggle.index + 1}/${wiggle.count}`
      : `<br><span class="kbd">2</span> picture (drop a .wiggle strip, a GIF or a side-by-side pair)`)
  );
}

// ---------------------------------------------------------------- input
function onKey(e) {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (typing && e.code !== 'Escape') return;

  if (app.mode === 'cal') {
    if (e.code === 'Space') { e.preventDefault(); calWizard.capture(); return; }
    if (e.code === 'Escape') { calWizard.cancel(); return; }
    if (e.code === 'Enter' && calWizard.step === 1) { calWizard.next1(); return; }
  }

  switch (e.code) {
    case 'KeyF': toggleFullscreen(document.documentElement); break;
    case 'KeyC':
      app.settings.previewOn = !app.settings.previewOn;
      preview.setVisible(app.settings.previewOn && app.source === 'camera');
      saveSettings(app.settings);
      break;
    case 'KeyD':
      app.settings.debugOn = !app.settings.debugOn;
      $('debug').classList.toggle('hidden', !app.settings.debugOn);
      saveSettings(app.settings);
      break;
    case 'KeyK':
      app.source = app.source === 'manual' ? 'camera' : 'manual';
      if (app.source === 'manual') { manual.x = app.eye.x; manual.y = app.eye.y; manual.z = app.eye.z; }
      else if (!tracker.ready) ensureTracking();
      preview.setVisible(app.settings.previewOn && app.source === 'camera');
      filter.reset();
      toast(app.source === 'manual' ? 'Keyboard / mouse head control' : 'Camera head tracking');
      break;
    case 'KeyV': {
      // next preset deeper than the current value, wrapping back to the glass
      const next = ANCHOR_PRESETS.find((p) => p > app.settings.anchor + 1e-6);
      setAnchor(next === undefined ? 0 : next);
      break;
    }
    case 'KeyN': setAnchor(app.settings.anchor - 0.1); break;
    case 'KeyM': setAnchor(app.settings.anchor + 0.1); break;
    case 'KeyR': calibrate(); break;
    case 'Escape': if (app.mode === 'view') toTitle(); break;
    case 'BracketLeft': case 'BracketRight': {
      const d = e.code === 'BracketRight' ? 0.05 : -0.05;
      app.settings.gain = Math.max(0.5, Math.min(2, app.settings.gain + d));
      saveSettings(app.settings);
      toast(`Parallax gain ${app.settings.gain.toFixed(2)}`);
      refreshHud();
      break;
    }
    case 'Minus': case 'NumpadSubtract':
      app.settings.previewWidth = Math.max(120, app.settings.previewWidth - 30);
      preview.setWidth(app.settings.previewWidth); saveSettings(app.settings); break;
    case 'Equal': case 'NumpadAdd':
      app.settings.previewWidth = Math.min(520, app.settings.previewWidth + 30);
      preview.setWidth(app.settings.previewWidth); saveSettings(app.settings); break;
    case 'Comma': case 'Period': {
      if (e.shiftKey) {                                   // < > : how much head travel sweeps the views
        app.settings.wiggleRangeCm = Math.max(2, Math.min(40, app.settings.wiggleRangeCm + (e.code === 'Period' ? 1 : -1)));
        saveSettings(app.settings);
        toast(`Head travel for the full sweep: ${app.settings.wiggleRangeCm} cm`);
        refreshHud();
        break;
      }
      const d = e.code === 'Period' ? 1.25 : 0.8;
      app.settings.minCutoff = Math.max(0.05, Math.min(20, app.settings.minCutoff * d));
      filter.setParams(app.settings); saveSettings(app.settings);
      toast(`minCutoff ${app.settings.minCutoff.toFixed(2)} (higher = snappier, jitterier)`);
      break;
    }
    case 'Semicolon': case 'Quote': {
      const d = e.code === 'Quote' ? 1.4 : 0.7;
      app.settings.beta = Math.max(0.0005, Math.min(1, app.settings.beta * d));
      filter.setParams(app.settings); saveSettings(app.settings);
      toast(`beta ${app.settings.beta.toFixed(4)} (higher = less lag when moving)`);
      break;
    }
    case 'Digit1': setContent('scene'); break;
    case 'Digit2': setContent('image'); break;
    case 'KeyO': pickFile(); break;
    case 'KeyW':
      app.settings.autoWiggle = !app.settings.autoWiggle; saveSettings(app.settings);
      toast(app.settings.autoWiggle ? 'Auto-wiggle (classic GIF playback)' : 'Head scrubs the views');
      refreshHud();
      break;
    case 'KeyS': case 'KeyA': toast('Anaglyph arrives in M4'); break;
    default: break;
  }

  // arrow keys nudge the head in keyboard mode
  if (app.source === 'manual') {
    const step = e.shiftKey ? 5 : 1;
    if (e.code === 'ArrowLeft') manual.x -= step;
    else if (e.code === 'ArrowRight') manual.x += step;
    else if (e.code === 'ArrowUp') manual.y += step;
    else if (e.code === 'ArrowDown') manual.y -= step;
    else if (e.code === 'PageUp') manual.z = Math.max(20, manual.z - step * 2);
    else if (e.code === 'PageDown') manual.z = Math.min(150, manual.z + step * 2);
    else return;
    e.preventDefault();
  }
}

function setAnchor(a) {
  app.settings.anchor = Math.round(Math.max(0, Math.min(1, a)) * 100) / 100;
  saveSettings(app.settings);
  const z = scene3d.anchorDepth(app.settings.anchor);
  toast(`Anchor: ${anchorLabel(app.settings.anchor)} holds still (z ${z.toFixed(0)} cm)` +
    (app.settings.anchor === 0 ? ' — exact window' : ''));
  refreshHud();
}

function setContent(c) {
  if (c === 'image' && !wiggle.loaded) { toast('Open a picture first: press O or drop a .wiggle strip, GIF or side-by-side pair'); return; }
  app.content = c;
  toast(c === 'image' ? `Picture: ${wiggle.name}` : '3D room');
  refreshHud();
}

async function openWiggle(src) {
  try {
    toast('Loading picture…', 3000);
    if (typeof src === 'string') await wiggle.loadUrl(src); else await wiggle.loadFile(src);
    app.content = 'image';
    if (app.mode !== 'view') { app.source = app.source || 'manual'; enterViewer(); }
    toast(`${wiggle.name}: ${wiggle.count} views — lean left and right`, 2600);
    refreshHud();
  } catch (err) {
    console.warn(err);
    toast(`Could not open that: ${err.message || err}`, 3000);
  }
}

function pickFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.jpg,.jpeg,.png,.gif,.jps,.webp,image/*';
  inp.onchange = () => { if (inp.files[0]) openWiggle(inp.files[0]); };
  inp.click();
}

function onMouse(e) {
  if (app.source !== 'manual' || manual.pinned) return;
  const r = canvas.getBoundingClientRect();
  manual.x = ((e.clientX - r.left) / r.width - 0.5) * 2 * 25;    // ±25 cm across the window
  manual.y = -((e.clientY - r.top) / r.height - 0.5) * 2 * 16;   // ±16 cm up and down
}

function onWheel(e) {
  if (app.source !== 'manual') return;
  manual.z = Math.max(20, Math.min(150, manual.z + Math.sign(e.deltaY) * 2));
}
