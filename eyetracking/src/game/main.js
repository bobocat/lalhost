// game/main.js — Head Dodge (docs/GAME.md). Same tracking pipeline as the viewer's
// main.js, then per frame: gestures → world.step → fx.sync → render.
//
// Shares the viewer's calibration (windowview.calibration.v1) and its render settings
// (gain, anchor, filter). Calibrate in the viewer first; the game links to it.

import * as THREE from 'three';
import {
  loadConfig, cfg, loadCalibration, loadSettings, loadGameSettings, saveGameSettings,
} from '../store.js';
import { Camera } from '../camera.js';
import { Tracker } from '../tracker.js';
import { headPose } from '../headpose.js';
import { HeadFilter } from '../filter.js';
import { ScreenGeometry, toggleFullscreen } from '../screen.js';
import { applyOffAxis, anchorShift } from '../projection.js';
import { Scene3D } from '../scene3d.js';
import { $, showScreen, showError, toast, setLost, bindActions, Preview } from '../ui.js';
import { World } from './world.js';
import { Gestures } from './gestures.js';
import { Fx, Sfx } from './fx.js';

const app = {
  mode: 'title',            // title | play | over | error
  source: 'camera',         // camera | manual
  cal: null, view: null, game: null,
  eye: { x: 0, y: 0, z: 50 }, restEye: { x: 0, y: 0, z: 50 }, camPos: { x: 0, y: 12, z: 0 },
  P: { x: 0, y: 0 }, M: { x: 0, y: -4 },
  mouthOffset: { x: 0, y: -4 },
  poseState: {}, lost: false,
  renderFps: 0,
};

const canvas = $('view'), video = $('video');
const camera = new Camera(video);
const tracker = new Tracker();
const filter = new HeadFilter();
const scene3d = new Scene3D();
const preview = new Preview($('preview'), video);
const gest = new Gestures();
const sfx = new Sfx();
let world, fx, screenGeom, renderer, cam3d;
let trackingStarting = null;
let lastFrame = 0, fpsT = 0, frames = 0;

// keyboard twins: Space is an edge, M is held; mouse moves the player in manual mode
const keys = { fire: false, magnet: false };
const manual = { x: 0, y: 0 };

// ---------------------------------------------------------------- boot
(async function boot() {
  await loadConfig();
  const c = cfg();
  app.view = loadSettings();
  app.game = loadGameSettings();
  app.cal = loadCalibration();
  gest.setNeutral(app.game.neutral);

  screenGeom = new ScreenGeometry(canvas, app.cal ? app.cal.diagonalInches : c.screen.diagonalInches);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x05070c, 1);
  cam3d = new THREE.PerspectiveCamera(60, 1, 1, 1000);
  onResize();

  scene3d.aimEnabled = c.scene.aimAtViewer !== false;
  await scene3d.load(c.scene.glb);
  // the game is set in space: the room's bounds still size the playfield and the aim
  // still points it at the viewer, but nothing of the room itself is drawn
  for (const n of scene3d.room.children) n.visible = false;
  scene3d.glass.visible = false;
  const depth = scene3d.bounds ? -scene3d.bounds.min.z : 150;
  world = new World({ depth, ...(c.game && c.game.world) });
  fx = new Fx(scene3d);
  fx.starfield(scene3d.scene);

  bindActions({
    play: () => play(),
    neutral: () => neutral(),
    keyboard: () => { app.source = 'manual'; play(); },
    retry: () => play(),
    menu: () => toTitle(),
  });
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onResize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouse);

  preview.setWidth(220);
  filter.setParams(app.view);
  filter.extrapolateMs = app.view.extrapolateMs;

  refreshTitle();
  showScreen('s-title');
  requestAnimationFrame(loop);
  window.HD = { app, world, gest, tracker };
  console.log('Head Dodge ready ·', scene3d.describe());

  const flags = new Set((location.hash || '').slice(1).split(';'));
  if (flags.has('debug')) app.game.debugOn = true;
  if (flags.has('manual')) { app.source = 'manual'; play(); }
  else if (flags.has('camera')) ensureTracking();
  // #manual;t=4;burst — advance the world 4 s, then shoot the nearest rock: a screenshot of
  // rocks and gems on a machine where requestAnimationFrame barely ticks.
  for (const f of flags) {
    if (f.startsWith('t=') && world) for (let t = 0; t < +f.slice(2); t += 0.05) world.step({ P: app.P, M: app.M, fire: false, magnet: false, eyeZ: 50 }, 0.05);
    if (f === 'burst' && world && world.rocks.length) {
      const r = world.rocks[0];
      world.step({ P: { x: r.x, y: r.y }, M: app.M, fire: true, magnet: false, eyeZ: 50 }, 0.05);
      for (let i = 0; i < 40; i++) world.step({ P: app.P, M: app.M, fire: false, magnet: i > 20, eyeZ: 50 }, 0.05);
    }
  }
})();

function refreshTitle() {
  $('calState').innerHTML = app.cal
    ? `Calibrated in Window View (${app.cal.diagonalInches}" screen, f ${app.cal.fPx.toFixed(0)} px).`
    : `<span class="warn">Not calibrated.</span> <a href="index.html#calibrate" style="color:var(--accent)">Calibrate in Window View first</a> — or play with the keyboard.`;
  $('neutralState').innerHTML = app.game.neutral
    ? `Neutral face captured (brow ${app.game.neutral.brow.toFixed(2)}, mouth ${app.game.neutral.mouth.toFixed(2)}). Recapture if the bars sit high with a straight face.`
    : 'Straight face, then press <b>Capture neutral</b> — 2 seconds. Makes the gestures measure from <em>your</em> resting face.';
  $('best').textContent = app.game.best ? `Best: ${app.game.best}` : '';
}

// ---------------------------------------------------------------- flow
async function ensureTracking() {
  if (tracker.ready && camera.running) return true;
  if (trackingStarting) return trackingStarting;
  trackingStarting = (async () => {
    try {
      toast('Starting the camera…', 2000);
      await camera.start(cfg().camera);
      toast('Loading the face model…', 4000);
      const delegate = await tracker.load({ blendshapes: true });
      app.source = 'camera';
      preview.setVisible(app.game.previewOn);
      toast(`Tracking on ${delegate}`, 1500);
      return true;
    } catch (e) {
      showError((e.message || String(e)) + ' — you can still play with the keyboard.');
      app.mode = 'error';
      return false;
    } finally { trackingStarting = null; }
  })();
  return trackingStarting;
}

async function play() {
  if (app.source === 'camera') {
    if (!app.cal) { toast('Calibrate in Window View first, or play with the keyboard', 2600); return; }
    if (!await ensureTracking()) return;
  }
  sfx.on = app.game.sound;
  sfx._ac();                                     // unlock audio on the click
  world.reset();
  filter.reset();
  app.mode = 'play';
  showScreen(null);
  $('hint').classList.remove('hidden');
  $('hint').innerHTML = app.source === 'manual'
    ? '<span class="kbd">mouse</span> move · <span class="kbd">Space</span> shoot · <span class="kbd">M</span> magnet · <span class="kbd">Esc</span> menu'
    : 'lean to dodge · eyebrows shoot · open mouth to collect · <span class="kbd">Esc</span> menu';
  $('debug').classList.toggle('hidden', !app.game.debugOn);
  preview.setVisible(app.game.previewOn && app.source === 'camera');
  lastFrame = performance.now();
  if (!screenGeom.fullscreen) toast('F for fullscreen', 1800);
}

async function neutral() {
  if (!await ensureTracking()) return;
  gest.startNeutralCapture(performance.now());
  $('neutralState').innerHTML = '<span class="warn">Hold a straight face…</span>';
}

function gameOver() {
  app.mode = 'over';
  sfx.over();
  if (world.score > (app.game.best || 0)) { app.game.best = world.score; saveGameSettings(app.game); }
  $('overScore').textContent = world.score;
  $('overStats').textContent = `wave ${world.wave + 1} · ${world.shot} rocks shot · ${world.collected} gems` +
    (world.score >= app.game.best && world.score > 0 ? ' · new best' : '');
  $('hint').classList.add('hidden');
  setLost(false);
  showScreen('s-over');
}

function toTitle() {
  app.mode = 'title';
  $('hint').classList.add('hidden');
  setLost(false);
  refreshTitle();
  showScreen('s-title');
}

// ---------------------------------------------------------------- per frame
function onResize() {
  screenGeom.update();
  const r = canvas.getBoundingClientRect();
  renderer.setPixelRatio(screenGeom.dpr);
  renderer.setSize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)), false);
  cam3d.aspect = r.width / Math.max(1, r.height);
}

function restingEye() {
  const cal = app.cal;
  const rel = (cal && cal.restRel) || { x: 0, y: 0, z: (cal && cal.distanceCm) || 50 };
  return { x: app.camPos.x + rel.x, y: app.camPos.y + rel.y, z: Math.max(20, rel.z) };
}

/** Track the head; returns gesture edges from this frame (camera) or the keys (manual). */
function sampleHead(now) {
  const c = cfg(), cal = app.cal;
  app.camPos = screenGeom.cameraPosition(cal ? cal.camPreset : c.camera.position, cal ? cal.camCustom : c.camera.customCm);
  app.restEye = restingEye();
  scene3d.aim(app.restEye);
  const reach = app.game.reach;

  if (app.source === 'manual') {
    filter.update({ x: app.restEye.x + manual.x / reach, y: app.restEye.y + manual.y / reach, z: app.restEye.z }, now);
    app.lost = false;
    app.mouthOffset = { x: 0, y: -4 };
    const g = { brow: keys.fire, mouth: keys.magnet };
    keys.fire = false;
    return g;
  }

  let g = { brow: false, mouth: gest.state.mouth.active };
  if (camera.running && tracker.ready && camera.hasNewFrame()) {
    const sample = tracker.detect(video);
    if (sample && cal && cal.fPx) {
      const frame = { width: tracker.captureWidth, height: tracker.captureHeight };
      const pose = headPose(sample, frame, cal, app.camPos, app.poseState);
      filter.update(pose, sample.t);
      // the mouth: upper-lip landmark relative to the iris midpoint, same pixels→cm as the head
      const lm = tracker.landmarks && tracker.landmarks[13];
      if (lm) {
        const fPx = cal.fPx * (cal.captureWidth ? frame.width / cal.captureWidth : 1);
        const z = pose.z - app.camPos.z;
        app.mouthOffset = {
          x: -(lm.x * frame.width - sample.u) / fPx * z,
          y: -(lm.y * frame.height - sample.v) / fPx * z,
        };
      }
    }
    if (sample || tracker.faceFound) {
      const r = gest.update(tracker.blendshapes, now);
      g = { brow: r.brow, mouth: r.mouth };
      if (r.neutralDone) onNeutralDone(r.neutralDone);
    }
    // keyboard twins work alongside the camera too
    if (keys.fire) { g.brow = true; keys.fire = false; }
    if (keys.magnet) g.mouth = true;
  }
  app.lost = tracker.lost(now);
  return g;
}

function onNeutralDone(n) {
  if (n.failed) { toast('No face seen — try again'); refreshTitle(); return; }
  app.game.neutral = { brow: n.brow, mouth: n.mouth };
  saveGameSettings(app.game);
  toast(`Neutral captured over ${n.samples} frames`);
  refreshTitle();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const g = sampleHead(now);
  const paused = app.source === 'camera' && app.lost;
  const e = paused ? filter.value : filter.at(now);
  app.eye = e;

  // player and mouth points: head offset from where it rests, scaled by reach (GAME.md §2.1)
  const reach = app.game.reach;
  app.P = { x: (e.x - app.restEye.x) * reach, y: (e.y - app.restEye.y) * reach };
  app.M = { x: app.P.x + app.mouthOffset.x * reach, y: app.P.y + app.mouthOffset.y * reach };

  if (app.mode === 'play' && !paused) {
    const events = world.step({ P: app.P, M: app.M, fire: g.brow, magnet: g.mouth, eyeZ: e.z }, dt);
    for (const ev of events) onEvent(ev, now);
  }

  // render exactly as the viewer does
  const gain = app.view.gain;
  const eye = { x: e.x * gain, y: e.y * gain, z: e.z };
  const d = { x: eye.x - app.restEye.x * gain, y: eye.y - app.restEye.y * gain };
  const shift = anchorShift(d, eye.z, scene3d.anchorDepth(app.view.anchor));
  applyOffAxis(cam3d, eye, screenGeom.rect(), null, shift);
  fx.sync(world, app.P, app.M, now);
  fx.setPlayerVisible(app.mode === 'play');
  renderer.render(scene3d.scene, cam3d);

  setLost(app.mode === 'play' && paused);
  preview.draw(tracker.landmarks, tracker.faceFound);
  if (app.mode === 'title') titleBars();
  if (app.mode === 'play') hud();
  frames++;
  if (!fpsT) fpsT = now; else if (now - fpsT > 1000) { app.renderFps = frames; frames = 0; fpsT = now; }
  if (app.game.debugOn) $('debug').innerHTML = debugText();
}

function onEvent(ev, now) {
  switch (ev.type) {
    case 'fired': sfx.fire(); break;
    case 'burst': fx.burst(ev, now); sfx.burst(); break;
    case 'collect': sfx.collect(ev.combo); break;
    case 'dodged': sfx.dodge(); break;
    case 'hit': {
      sfx.hit();
      const f = $('flash'); f.classList.add('hit'); setTimeout(() => f.classList.remove('hit'), 60);
      break;
    }
    case 'wave': if (ev.wave > 0) { sfx.wave(); toast(`Wave ${ev.wave + 1}`); } break;
    case 'over': gameOver(); break;
    default: break;
  }
}

// ---------------------------------------------------------------- HUD
function hud() {
  const hearts = '♥'.repeat(Math.max(0, world.lives)) + '<span style="opacity:.3">' + '♥'.repeat(Math.max(0, 3 - world.lives)) + '</span>';
  $('hud').innerHTML = `<span class="score">${world.score}</span>${world.mult > 1 ? ' <span class="good">×2</span>' : ''}` +
    `<br>${hearts} &nbsp; wave ${world.wave + 1}` +
    (world.invulnerable ? ' <span class="warn">·</span>' : '');
}

function titleBars() {
  const on = gest.state;
  for (const [id, cap] of [['brow', 'Brow'], ['mouth', 'Mouth']]) {
    const v = gest.score[id];
    const bar = $('bar' + cap);
    bar.querySelector('i').style.width = `${Math.min(100, v * 100).toFixed(0)}%`;
    bar.querySelector('b').style.left = `${gest.defs[id].on * 100}%`;
    bar.classList.toggle('on', on[id].above);
    $('val' + cap).textContent = tracker.blendshapes ? v.toFixed(2) : '—';
  }
}

function debugText() {
  const f = (v, n = 1) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(n) : '—');
  const s = gest.score, st = gest.state;
  return [
    `<b>Head Dodge</b> · ${app.renderFps} fps render · ${app.source === 'camera' ? `${tracker.fps} fps track · ${tracker.inferMs.toFixed(1)} ms` : 'keyboard'}`,
    `eye      (${f(app.eye.x)}, ${f(app.eye.y)}, ${f(app.eye.z)}) · rest (${f(app.restEye.x)}, ${f(app.restEye.y)}, ${f(app.restEye.z)}) · reach ${app.game.reach}`,
    `player   P (${f(app.P.x)}, ${f(app.P.y)}) · mouth M (${f(app.M.x)}, ${f(app.M.y)})`,
    `brow     ${s.brow.toFixed(2)} ${st.brow.above ? '<span class="good">above</span>' : ''} · mouth ${s.mouth.toFixed(2)} ${st.mouth.active ? '<span class="good">open</span>' : ''}` +
      ` · neutral ${app.game.neutral ? `${app.game.neutral.brow.toFixed(2)}/${app.game.neutral.mouth.toFixed(2)}` : 'none'}`,
    `world    rocks ${world.rocks.length} · bolts ${world.bolts.length} · gems ${world.gems.length} · t ${world.t.toFixed(0)} s · combo ${world.combo}`,
    `render   anchor ${Math.round(app.view.anchor * 100)}% · gain ${app.view.gain.toFixed(2)} · aim ${scene3d.aimDeg.toFixed(1)}°`,
  ].join('\n');
}

// ---------------------------------------------------------------- input
function onKeyDown(e) {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  switch (e.code) {
    case 'Space':
      if (app.mode === 'play') { if (!e.repeat) keys.fire = true; }
      else if (app.mode === 'over' || app.mode === 'title') play();
      e.preventDefault();
      break;
    case 'KeyM': keys.magnet = true; break;
    case 'KeyF': toggleFullscreen(document.documentElement); break;
    case 'KeyC':
      app.game.previewOn = !app.game.previewOn; saveGameSettings(app.game);
      preview.setVisible(app.game.previewOn && app.source === 'camera'); break;
    case 'KeyD':
      app.game.debugOn = !app.game.debugOn; saveGameSettings(app.game);
      $('debug').classList.toggle('hidden', !app.game.debugOn); break;
    case 'KeyS':
      app.game.sound = !app.game.sound; sfx.on = app.game.sound; saveGameSettings(app.game);
      toast(app.game.sound ? 'Sound on' : 'Sound off'); break;
    case 'KeyK':
      app.source = app.source === 'manual' ? 'camera' : 'manual';
      if (app.source === 'camera' && !tracker.ready) ensureTracking();
      preview.setVisible(app.game.previewOn && app.source === 'camera');
      toast(app.source === 'manual' ? 'Keyboard / mouse control' : 'Camera control');
      break;
    case 'Escape':
      if (app.mode === 'play') toTitle();
      break;
    default: return;
  }
}

function onKeyUp(e) { if (e.code === 'KeyM') keys.magnet = false; }

function onMouse(e) {
  if (app.source !== 'manual') return;
  const r = canvas.getBoundingClientRect();
  manual.x = ((e.clientX - r.left) / r.width - 0.5) * 2 * world.cfg.fieldX;
  manual.y = -((e.clientY - r.top) / r.height - 0.5) * 2 * world.cfg.fieldY;
}
