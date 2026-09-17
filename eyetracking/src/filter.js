// filter.js — One Euro filter (Casiez et al. 2012) on each of ex, ey, ez, plus
// velocity extrapolation so the render loop can run ahead of the 30 fps tracker.
//
// minCutoff sets the smoothing when still (lower = steadier, laggier); beta sets how
// fast the filter opens up when moving (higher = less lag, more jitter while moving).

const alpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;      // filtered value
    this.dx = 0;        // filtered derivative, units per second
    this.tPrev = 0;
    this.rawPrev = 0;
  }

  reset() { this.x = null; this.dx = 0; }

  filter(value, t) {
    if (this.x === null) { this.x = value; this.rawPrev = value; this.tPrev = t; return value; }
    const dt = Math.max(1e-3, (t - this.tPrev) / 1000);
    this.tPrev = t;
    const dRaw = (value - this.rawPrev) / dt;
    this.rawPrev = value;
    this.dx = this.dx + alpha(this.dCutoff, dt) * (dRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = this.x + alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export class HeadFilter {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0, extrapolateMs = 50 } = {}) {
    this.axes = [new OneEuro(minCutoff, beta, dCutoff), new OneEuro(minCutoff, beta, dCutoff), new OneEuro(minCutoff, beta, dCutoff)];
    this.extrapolateMs = extrapolateMs;
    this.value = { x: 0, y: 0, z: 60 };
    this.raw = { x: 0, y: 0, z: 60 };
    this.tLast = 0;
    this.primed = false;
  }

  setParams({ minCutoff, beta, dCutoff }) {
    for (const a of this.axes) {
      if (Number.isFinite(minCutoff)) a.minCutoff = minCutoff;
      if (Number.isFinite(beta)) a.beta = beta;
      if (Number.isFinite(dCutoff)) a.dCutoff = dCutoff;
    }
  }

  reset() { for (const a of this.axes) a.reset(); this.primed = false; }

  /** Feed one tracker sample (cm, performance.now() milliseconds). */
  update(p, t) {
    this.raw = { x: p.x, y: p.y, z: p.z };
    this.value = {
      x: this.axes[0].filter(p.x, t),
      y: this.axes[1].filter(p.y, t),
      z: this.axes[2].filter(p.z, t),
    };
    this.tLast = t;
    this.primed = true;
    return this.value;
  }

  /** Filtered position advanced by velocity to `t`, capped so a stall cannot fly away. */
  at(t) {
    if (!this.primed) return this.value;
    const dt = Math.min(this.extrapolateMs, Math.max(0, t - this.tLast)) / 1000;
    return {
      x: this.value.x + this.axes[0].dx * dt,
      y: this.value.y + this.axes[1].dx * dt,
      z: this.value.z + this.axes[2].dx * dt,
    };
  }

  velocity() { return { x: this.axes[0].dx, y: this.axes[1].dx, z: this.axes[2].dx }; }
}
