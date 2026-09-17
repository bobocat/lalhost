// screen.js — physical geometry of the canvas (docs/DESIGN.md §2.3).
//
// Everything downstream works in screen space: origin at the centre of the canvas,
// +X viewer's right, +Y up, +Z toward the viewer, centimetres. This module answers
// two questions: how big is the canvas in centimetres, and where is the webcam
// relative to its centre.
//
// Caveat kept honest in the HUD: `screen.width * devicePixelRatio` is the true panel
// pixel count only at 100% browser zoom. Fullscreen is exact; windowed adds a guess at
// the browser chrome height, so it is approximate by design.

export class ScreenGeometry {
  constructor(canvas, diagonalInches = 15.6) {
    this.canvas = canvas;
    this.diagonalCm = diagonalInches * 2.54;
    this.W = 34; this.H = 19;                 // canvas size in cm, recomputed by update()
    this.offset = { x: 0, y: 0 };             // canvas centre relative to display centre, cm
    this.pitch = 0.02;                        // cm per device pixel
    this.dpr = 1;
    this.displayW = 34; this.displayH = 19;
    this.update();
  }

  setDiagonalInches(d) { this.diagonalCm = d * 2.54; this.update(); }

  get fullscreen() { return !!document.fullscreenElement; }

  update() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const pxW = screen.width * dpr, pxH = screen.height * dpr;
    this.pitch = this.diagonalCm / Math.hypot(pxW, pxH);     // cm per device pixel
    const cmPerCss = this.pitch * dpr;
    this.displayW = screen.width * cmPerCss;
    this.displayH = screen.height * cmPerCss;

    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, r.width * cmPerCss);
    this.H = Math.max(1, r.height * cmPerCss);

    if (this.fullscreen) {
      this.offset = { x: 0, y: 0 };
      this.approximate = false;
    } else {
      // Where is the canvas centre on the physical display? window.screenX/Y is the
      // outer window; the difference between outer and inner sizes is the chrome, and
      // on desktop browsers essentially all of the vertical part of it is on top.
      const chromeX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
      const chromeY = Math.max(0, window.outerHeight - window.innerHeight - chromeX);
      const cx = window.screenX + chromeX + r.left + r.width / 2;
      const cy = window.screenY + chromeY + r.top + r.height / 2;
      this.offset = {
        x: (cx - screen.width / 2) * cmPerCss,
        y: -(cy - screen.height / 2) * cmPerCss,          // screen y grows downward
      };
      this.approximate = true;
    }
    return this;
  }

  /** The window rectangle in screen space: corners of the canvas at z = 0. */
  rect() {
    return { W: this.W, H: this.H, halfW: this.W / 2, halfH: this.H / 2 };
  }

  /**
   * Webcam position in screen space (canvas-centred), from a preset relative to the
   * display. `custom` is given in cm relative to the display centre.
   */
  cameraPosition(preset = 'top-centre', custom = { x: 0, y: 12, z: 0 }) {
    const halfW = this.displayW / 2, halfH = this.displayH / 2;
    const inset = 1.0;                                   // webcams sit ~1 cm above the panel
    let p;
    switch (preset) {
      case 'top-left':  p = { x: -halfW + 1.5, y: halfH + inset, z: 0 }; break;
      case 'top-right': p = { x: halfW - 1.5,  y: halfH + inset, z: 0 }; break;
      case 'custom':    p = { x: +custom.x || 0, y: +custom.y || 0, z: +custom.z || 0 }; break;
      default:          p = { x: 0, y: halfH + inset, z: 0 };
    }
    return { x: p.x - this.offset.x, y: p.y - this.offset.y, z: p.z };
  }

  describe() {
    return `${this.W.toFixed(1)}×${this.H.toFixed(1)} cm` +
      (this.fullscreen ? ' (fullscreen, exact)' : ' (windowed, approximate — press F)');
  }
}

export async function toggleFullscreen(el) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.requestFullscreen({ navigationUI: 'hide' });
  } catch (e) { console.warn('fullscreen refused', e); }
}
