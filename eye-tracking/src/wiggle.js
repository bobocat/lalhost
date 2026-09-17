// wiggle.js — scrub a strip of stereo views with the head (docs/RESEARCH.md §4d).
//
// A wigglegram is a run of views of one scene from viewpoints along a line, left to
// right. Played as a GIF it wiggles; here the head position picks the view instead, so
// leaning left shows the leftmost photo and leaning right the rightmost, with the
// in-between views (synthesised by tools/make_wiggle.py) filling the gaps. The picture
// sits on a plane behind the glass; the plane is pinned to the screen (anchor at its own
// depth) because the parallax comes from the frames, not from the plane moving.
//
// Accepts: `name.wiggle9.jpg` strips from the tool (N views side by side, N in the name),
// any GIF (frames become views; a ping-pong GIF is folded back to one sweep), or a plain
// side-by-side pair (two views, the crude wiggle). GIFs are decoded by omggif, loaded on
// demand from the CDN.

import * as THREE from 'three';

const OMGGIF_URL = 'https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.js';

export class WiggleStrip {
  constructor(scene) {
    this.scene = scene;
    this.frames = [];          // canvases, left → right
    this.textures = [];
    this.mesh = null;
    this.index = -1;
    this.name = '';
    this.aspect = 1.5;
    this.autoT = 0;
  }

  get loaded() { return this.frames.length > 0; }
  get count() { return this.frames.length; }

  // ---------------------------------------------------------------- loading
  async loadFile(file) {
    const buf = await file.arrayBuffer();
    return this.loadBuffer(buf, file.name);
  }

  async loadUrl(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return this.loadBuffer(await r.arrayBuffer(), url.split('/').pop());
  }

  async loadBuffer(buf, name) {
    const bytes = new Uint8Array(buf);
    let frames;
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) frames = await decodeGif(bytes);
    else {
      const img = await decodeImage(new Blob([buf]));
      const m = /\.wiggle(\d+)\./i.exec(name);
      const n = m ? +m[1] : 2;                     // no count in the name: treat as a pair
      frames = splitStrip(img, n);
    }
    this.dispose();
    this.frames = frames;
    this.name = name;
    this.aspect = frames[0].width / frames[0].height;
    this.textures = frames.map((c) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.textures[0], toneMapped: false }));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.index = 0;
    return this;
  }

  dispose() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
    for (const t of this.textures) t.dispose();
    this.frames = []; this.textures = []; this.mesh = null; this.index = -1;
  }

  // ---------------------------------------------------------------- placement
  /**
   * Put the picture plane at depth `D` (cm, negative = behind the glass), centred on the
   * resting line of sight and sized to fill the window from the resting eye.
   */
  place(D, rect, restEye) {
    if (!this.mesh) return;
    const rz = Math.max(20, restEye.z);
    const scale = (rz - D) / rz;                              // how much bigger than the window
    const fillW = rect.W * scale, fillH = rect.H * scale;
    let w = fillW, h = fillW / this.aspect;                   // contain: whole picture visible
    if (h > fillH) { h = fillH; w = fillH * this.aspect; }
    this.mesh.scale.set(w, h, 1);
    this.mesh.position.set(restEye.x * (1 - scale), restEye.y * (1 - scale), D);
  }

  /**
   * Choose the view from the head's lateral offset from rest: −range/2 → leftmost,
   * +range/2 → rightmost. Returns the fractional index.
   */
  scrub(dx, rangeCm) {
    if (!this.mesh) return 0;
    const t = Math.min(1, Math.max(0, dx / rangeCm + 0.5));
    const f = t * (this.count - 1);
    this._show(Math.round(f));
    return f;
  }

  /** Classic wiggle: ping-pong through the views at `hz` sweeps per second. */
  autoplay(now, hz = 3) {
    if (!this.mesh) return;
    const period = 1000 / hz;
    const phase = (now % (2 * period)) / period;            // 0..2
    const t = phase <= 1 ? phase : 2 - phase;
    this._show(Math.round(t * (this.count - 1)));
  }

  _show(i) {
    if (i === this.index) return;
    this.index = i;
    this.mesh.material.map = this.textures[i];
    this.mesh.material.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- decoders
function decodeImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}

function splitStrip(img, n) {
  const w = Math.floor(img.width / n), h = img.height;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, i * w, 0, w, h, 0, 0, w, h);
    out.push(c);
  }
  return out;
}

let gifLib = null;
async function loadOmggif() {
  if (gifLib) return gifLib;
  if (typeof window.GifReader === 'function') return (gifLib = window.GifReader);
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OMGGIF_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load the GIF decoder from the CDN'));
    document.head.appendChild(s);
  });
  return (gifLib = window.GifReader);
}

/** Every frame of a GIF as a full canvas, then folded to one sweep if it ping-pongs. */
async function decodeGif(bytes) {
  const GifReader = await loadOmggif();
  const g = new GifReader(bytes);
  const w = g.width, h = g.height;
  const pixels = new Uint8ClampedArray(w * h * 4);          // accumulates: frames may be partial
  const out = [];
  for (let i = 0; i < g.numFrames(); i++) {
    g.decodeAndBlitFrameRGBA(i, pixels);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(pixels.slice(), w, h), 0, 0);
    out.push(c);
  }
  return foldPingPong(out);
}

/** 0 1 2 3 2 1 → 0 1 2 3: the sweep turns around where a frame repeats the one before last. */
function foldPingPong(frames) {
  if (frames.length < 4) return frames;
  const sig = frames.map(thumbnail);
  for (let i = 2; i < frames.length; i++) {
    if (diff(sig[i], sig[i - 2]) < 2 && diff(sig[i], sig[i - 1]) > 2) return frames.slice(0, i);
  }
  return frames;
}

function thumbnail(c) {
  const t = document.createElement('canvas');
  t.width = 32; t.height = 32;
  const ctx = t.getContext('2d');
  ctx.drawImage(c, 0, 0, 32, 32);
  return ctx.getImageData(0, 0, 32, 32).data;
}

function diff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s / (a.length / 4) / 3;                              // mean abs difference per channel
}
