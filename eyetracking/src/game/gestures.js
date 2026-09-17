// gestures.js — blendshape scores → brow / mouth states (docs/GAME.md §3).
//
// Ported from Face Pilot: on/off thresholds with hysteresis, a minimum hold before a
// gesture counts, a cooldown before it can fire again, and the rule that it must fall
// below `off` before re-arming, so a held expression fires once. Scores are measured
// relative to a captured neutral face; without one the raw score is used.

const DEFS = {
  brow:  { on: 0.50, off: 0.30, minHold: 80,  cooldown: 250, type: 'momentary' },
  mouth: { on: 0.55, off: 0.35, minHold: 100, cooldown: 0,   type: 'hold' },
};

export const NEUTRAL_MS = 2000;

const min = (...v) => Math.min(...v.map((x) => x || 0));

/** Raw gesture scores from the 52 blendshapes. */
export function rawScores(bs) {
  if (!bs) return { brow: 0, mouth: 0 };
  return {
    brow: Math.max(bs.browInnerUp || 0, min(bs.browOuterUpLeft, bs.browOuterUpRight)),
    mouth: bs.jawOpen || 0,
  };
}

export class Gestures {
  constructor(defs = {}) {
    this.defs = { brow: { ...DEFS.brow, ...defs.brow }, mouth: { ...DEFS.mouth, ...defs.mouth } };
    this.neutral = { brow: 0, mouth: 0 };
    this.score = { brow: 0, mouth: 0 };       // after neutral subtraction, what the bars show
    this.state = {
      brow:  { above: false, since: 0, armed: true, firedAt: -1e9, active: false },
      mouth: { above: false, since: 0, armed: true, firedAt: -1e9, active: false },
    };
    this.capture = null;                      // {until, samples: {brow: [], mouth: []}}
  }

  setNeutral(n) { if (n) this.neutral = { brow: +n.brow || 0, mouth: +n.mouth || 0 }; }

  startNeutralCapture(now) {
    this.capture = { until: now + NEUTRAL_MS, samples: { brow: [], mouth: [] } };
  }

  get capturing() { return !!this.capture; }

  /**
   * Feed one tracker frame. Returns {brow: fired-this-frame, mouth: held, neutralDone}.
   * `brow` is an edge: true on exactly one frame per raise.
   */
  update(bs, now) {
    const raw = rawScores(bs);
    let neutralDone = null;
    if (this.capture) {
      if (bs) { this.capture.samples.brow.push(raw.brow); this.capture.samples.mouth.push(raw.mouth); }
      if (now >= this.capture.until) {
        const s = this.capture.samples;
        this.capture = null;
        if (s.brow.length >= 5) {
          this.neutral = { brow: median(s.brow), mouth: median(s.mouth) };
          neutralDone = { ...this.neutral, samples: s.brow.length };
        } else neutralDone = { failed: true, samples: s.brow.length };
      }
    }

    const out = { brow: false, mouth: false, neutralDone };
    for (const id of ['brow', 'mouth']) {
      const d = this.defs[id], st = this.state[id];
      const v = Math.max(0, raw[id] - this.neutral[id]);
      this.score[id] = v;

      if (!st.above && v >= d.on) { st.above = true; st.since = now; }
      else if (st.above && v < d.off) { st.above = false; st.active = false; st.armed = true; }

      if (d.type === 'hold') {
        // held gestures are "on" once they have been above the threshold for minHold
        st.active = st.above && (now - st.since) >= d.minHold;
        out[id] = st.active;
      } else {
        const ready = st.above && st.armed && (now - st.since) >= d.minHold && (now - st.firedAt) >= d.cooldown;
        if (ready) { st.armed = false; st.firedAt = now; out[id] = true; }
      }
    }
    return out;
  }
}

function median(a) {
  const s = [...a].sort((p, q) => p - q), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
