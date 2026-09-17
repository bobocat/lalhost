// debug.js — the `D` panel. Its whole job is to be honest: raw next to filtered, the
// numbers the head position is derived from, and where the latency goes.

const f = (v, n = 2) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(n) : '—');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function debugPanel(app) {
  const { tracker, filter, screenGeom: sg, settings, source } = app;
  const cal = app.cal;
  const raw = app.rawPose, filt = app.eye, vel = filter.velocity();
  const m = tracker.matrix;
  const r = tracker.result;

  const lat = app.latencyMs;
  const rows = [];

  rows.push(`<b>Window View</b> · ${esc(app.scene3d.describe())}`);

  rows.push(source === 'camera'
    ? `tracker  ${tracker.delegate || '—'} · ${tracker.fps} fps · ${tracker.inferMs.toFixed(1)} ms infer · ` +
      `face ${tracker.faceFound ? '<span style="color:#7dffb3">yes</span>' : '<span style="color:#ff6b8b">lost</span>'}` +
      ` · capture ${tracker.captureWidth}×${tracker.captureHeight}`
    : 'tracker  <span style="color:#ffca6b">keyboard / mouse</span> — move the mouse, wheel for distance');

  if (r) {
    rows.push(`iris     u ${r.u.toFixed(1)} v ${r.v.toFixed(1)} px · ipd ${r.ipdPx.toFixed(1)} px` +
      ` · yaw ${(r.yaw * 180 / Math.PI).toFixed(1)}° (${r.yawSource})${app.rawPose.frozen ? ' <span style="color:#ffca6b">z frozen</span>' : ''}`);
  }
  if (m) {
    rows.push(`matrix   ${m.layout} · t (${f(m.tx, 1)}, ${f(m.ty, 1)}, ${f(m.tz, 1)}) cm` +
      ` · pitch ${(m.pitch * 180 / Math.PI).toFixed(0)}°`);
  }

  rows.push(`raw   E  x ${f(raw.x)}  y ${f(raw.y)}  z ${f(raw.z)} cm`);
  rows.push(`filt  E  x ${f(filt.x)}  y ${f(filt.y)}  z ${f(filt.z)} cm  <span style="opacity:.6">(gain ${settings.gain.toFixed(2)})</span>`);
  rows.push(`speed    ${f(vel.x, 1)}, ${f(vel.y, 1)}, ${f(vel.z, 1)} cm/s · extrapolating ${settings.extrapolateMs} ms`);
  rows.push(source === 'camera'
    ? `latency  ~${lat.toFixed(0)} ms frame→now +${(1000 / 60).toFixed(0)} ms display ≈ ${(lat + 16.7).toFixed(0)} ms motion-to-photon`
    : 'latency  n/a without a camera');
  rows.push(`render   ${app.renderFps} fps · ${app.renderMs.toFixed(1)} ms`);

  rows.push(`screen   ${sg.W.toFixed(1)}×${sg.H.toFixed(1)} cm ${sg.fullscreen ? '(fullscreen)' : '(windowed, approximate)'}` +
    ` · ${(sg.pitch * 10).toFixed(3)} mm/px · dpr ${sg.dpr.toFixed(2)}`);
  rows.push(`camera   at (${f(app.camPos.x, 1)}, ${f(app.camPos.y, 1)}) cm from the canvas centre · ${cal ? esc(cal.camPreset) : '—'}`);
  rows.push(`aim      rest eye (${f(app.restEye.x, 1)}, ${f(app.restEye.y, 1)}, ${f(app.restEye.z, 1)}) cm` +
    ` · room tilted ${f(app.scene3d.aimDeg, 1)}°${cal && cal.restRel ? '' : ' (assumed: eyes level with the webcam)'}`);
  if (cal) rows.push(`calib    f ${cal.fPx.toFixed(0)} px · ipd ${cal.ipdMm} mm · at ${cal.distanceCm} cm · ${cal.diagonalInches}"`);
  const a = app.anchor;
  rows.push(`anchor   ${a.mode === 'image' ? 'the picture plane' : `${Math.round(a.mode * 100)}% of room depth`} (z ${a.depth.toFixed(0)})` +
    ` · t ${a.t.toFixed(2)} · screen slid (${f(a.shift.x, 1)}, ${f(a.shift.y, 1)}) cm` + (a.mode === 0 ? ' · exact window' : ''));
  rows.push(`filter   minCutoff ${settings.minCutoff.toFixed(2)} <span style="opacity:.6">, .</span>` +
    ` · beta ${settings.beta.toFixed(3)} <span style="opacity:.6">; '</span>`);

  return rows.join('\n');
}
