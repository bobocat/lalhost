// calibrate.js — the three-step calibration wizard (docs/DESIGN.md §2.4).
//
// 1. Screen: diagonal in inches and where the webcam sits.
// 2. Distance: one second of iris-spacing samples at a stated distance gives f_px, the
//    webcam's focal length in pixels — the single number that turns pixels into
//    centimetres. The median is used so a stray frame cannot skew it.
// 3. Check: live position readout and the scene, with the parallax gain slider.
//
// The wizard owns a draft calibration; main.js renders from it as soon as step 3 opens,
// which is what makes the check step a real check.

import { $, showScreen, toast } from './ui.js';
import { focalFromCapture, headPose, median } from './headpose.js';

const CAPTURE_MS = 1000;

export class Calibration {
  constructor({ screenGeom, tracker, cfg, onLive, onDone, onCancel }) {
    this.screenGeom = screenGeom;
    this.tracker = tracker;
    this.cfg = cfg;
    this.onLive = onLive;       // () => {x,y,z} | null, the current head position in cm
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.step = 0;
    this.draft = null;
    this.capturing = null;      // {until, samples[]}
    this._wireInputs();
  }

  get active() { return this.step > 0; }

  _wireInputs() {
    $('campos').addEventListener('change', () => this._syncCustomRow());
    $('diag').addEventListener('input', () => this._screenInfo());
    $('gain').addEventListener('input', () => {
      const g = +$('gain').value;
      $('gainVal').textContent = g.toFixed(2);
      if (this.draft) this.draft.gain = g;
    });
  }

  _syncCustomRow() {
    const custom = $('campos').value === 'custom';
    $('customRow').style.display = custom ? '' : 'none';
    $('customLabel').style.display = custom ? '' : 'none';
  }

  _screenInfo() {
    const d = +$('diag').value || 15.6;
    this.screenGeom.setDiagonalInches(d);
    const s = this.screenGeom;
    $('screenInfo').textContent =
      `${screen.width}×${screen.height} at ${s.dpr.toFixed(2)}× → panel about ` +
      `${s.displayW.toFixed(1)}×${s.displayH.toFixed(1)} cm, ${(s.pitch * 10).toFixed(3)} mm per pixel.`;
  }

  /** Open the wizard, pre-filled from an existing calibration or from config.json. */
  start(existing) {
    const c = this.cfg;
    const base = existing || {
      diagonalInches: c.screen.diagonalInches,
      camPreset: c.camera.position,
      camCustom: { ...c.camera.customCm },
      ipdMm: c.ipdMm,
      distanceCm: 50,
      gain: c.parallaxGain,
      fPx: 0,
    };
    this.draft = { ...base, camCustom: { ...(base.camCustom || c.camera.customCm) } };
    $('diag').value = this.draft.diagonalInches;
    $('campos').value = this.draft.camPreset;
    $('camx').value = this.draft.camCustom.x;
    $('camy').value = this.draft.camCustom.y;
    $('ipd').value = this.draft.ipdMm;
    $('dist').value = this.draft.distanceCm;
    $('gain').value = this.draft.gain;
    $('gainVal').textContent = (+this.draft.gain).toFixed(2);
    this._syncCustomRow();
    this._screenInfo();
    showScreen('s-cal');
    this._goto(1);
  }

  _goto(n) {
    this.step = n;
    for (const i of [1, 2, 3]) $('cal' + i).classList.toggle('hidden', i !== n);
    for (const el of document.querySelectorAll('.steps span')) el.classList.toggle('on', +el.dataset.step === n);
  }

  // ---- step transitions -----------------------------------------------------
  next1() {
    const d = +$('diag').value;
    if (!(d >= 5 && d <= 90)) { toast('Screen diagonal looks wrong — expected 5 to 90 inches'); return; }
    this.draft.diagonalInches = d;
    this.draft.camPreset = $('campos').value;
    this.draft.camCustom = { x: +$('camx').value || 0, y: +$('camy').value || 0, z: 0 };
    this.screenGeom.setDiagonalInches(d);
    this._goto(2);
  }

  back(n) { this._goto(n); }

  capture() {
    if (this.step !== 2) return;
    if (!this.tracker.faceFound) { toast('No face yet — check the light and the camera preview'); return; }
    const d = +$('dist').value, ipd = +$('ipd').value;
    if (!(d >= 25 && d <= 150)) { toast('Distance should be between 25 and 150 cm'); return; }
    if (!(ipd >= 45 && ipd <= 80)) { toast('Eye spacing should be between 45 and 80 mm'); return; }
    this.draft.distanceCm = d;
    this.draft.ipdMm = ipd;
    this.capturing = { until: performance.now() + CAPTURE_MS, samples: [] };
  }

  save() {
    const s = this.screenGeom;
    const cal = {
      ...this.draft,
      gain: +$('gain').value,
      screenW: screen.width, screenH: screen.height, dpr: s.dpr,
      savedAt: new Date().toISOString(),
    };
    this.step = 0;
    this.capturing = null;
    this.onDone(cal);
  }

  cancel() {
    this.step = 0;
    this.capturing = null;
    this.onCancel();
  }

  /** Called once per rendered frame while the wizard is open. */
  tick(now) {
    if (this.step === 2) this._tick2(now);
    else if (this.step === 3) this._tick3();
  }

  _tick2(now) {
    const r = this.tracker.result;
    if (this.capturing) {
      if (r && this.tracker.faceFound) this.capturing.samples.push({ ipd: r.ipdPx, u: r.u, v: r.v });
      const left = Math.max(0, this.capturing.until - now);
      $('cal2read').innerHTML = `holding still… <span class="mono">${(left / 1000).toFixed(1)} s</span> ` +
        `· ${this.capturing.samples.length} samples`;
      if (left > 0) return;
      const s = this.capturing.samples;
      this.capturing = null;
      if (s.length < 5) { $('cal2read').innerHTML = '<span class="bad">too few samples — try again</span>'; return; }
      const ipdPx = median(s.map((x) => x.ipd));
      this.draft.ipdPx = ipdPx;
      this.draft.captureWidth = this.tracker.captureWidth || 0;
      this.draft.fPx = focalFromCapture({
        ipdPx, distanceCm: this.draft.distanceCm, ipdMm: this.draft.ipdMm,
      });
      // Where the viewer's eyes rest, relative to the webcam. The scene is aimed at this
      // point so that sitting normally looks straight into the room rather than down at
      // its floor. Stored camera-relative so it survives moving between windowed and
      // fullscreen, where the canvas centre moves but the webcam does not.
      const frame = { width: this.draft.captureWidth, height: this.tracker.captureHeight || 0 };
      const rest = headPose({ u: median(s.map((x) => x.u)), v: median(s.map((x) => x.v)), ipdPx, yaw: 0 },
        frame, this.draft, { x: 0, y: 0, z: 0 }, {});
      this.draft.restRel = { x: rest.x, y: rest.y, z: rest.z };
      const fovDeg = 2 * Math.atan((this.draft.captureWidth / 2) / this.draft.fPx) * 180 / Math.PI;
      toast(`f = ${this.draft.fPx.toFixed(0)} px (about ${fovDeg.toFixed(0)}° horizontal field of view)`, 2600);
      this._goto(3);
      return;
    }
    if (!r || !this.tracker.faceFound) { $('cal2read').innerHTML = '<span class="bad">no face — sit in frame, face the screen</span>'; return; }
    $('cal2read').innerHTML = `eye spacing <b>${r.ipdPx.toFixed(1)} px</b>` +
      `<span class="note"> · yaw ${(r.yaw * 180 / Math.PI).toFixed(0)}°</span>`;
  }

  _tick3() {
    const e = this.onLive();
    $('cal3read').innerHTML = e
      ? `x <b>${e.x >= 0 ? '+' : ''}${e.x.toFixed(1)}</b> &nbsp; y <b>${e.y >= 0 ? '+' : ''}${e.y.toFixed(1)}</b>` +
        ` &nbsp; distance <b>${e.z.toFixed(1)}</b> <span class="note">cm</span>`
      : '<span class="bad">no face</span>';
  }
}
