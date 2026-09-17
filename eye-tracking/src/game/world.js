// world.js — Head Dodge rules (docs/GAME.md §4). Pure: no three.js, no DOM, so it runs
// in Node for tests. Coordinates are the room's own frame, centimetres: x right, y up,
// z toward the glass, the glass at z = 0, the back wall at −depth.
//
// step() takes the player's inputs for one frame and returns the events that happened,
// which fx.js turns into flashes and sounds.

export const DEFAULTS = {
  depth: 150,                 // room depth, cm — overwritten from the scene bounds
  fieldX: 38, fieldY: 24,     // playfield half-size, a little inside the walls
  playerR: 4,                 // player hit radius, cm
  lives: 3,
  invulnS: 1.5,
  waveS: 15,
  spawnBaseS: 1.1, spawnPerWave: 0.2,
  speedBase: 45, speedPerWave: 8, speedMax: 130,
  rockRmin: 3, rockRmax: 6,
  boltSpeed: 260,
  gemsMin: 5, gemsMax: 8, gemLifeS: 12,
  // the magnet reaches everything on screen: no cone, and a pull strong enough to fetch a
  // gem from the back wall in about a second
  magnetK: 9e6, magnetAmax: 1800, magnetVmax: 450, magnetConeDeg: 180, magnetZ: 6,
  collectR: 4,
  comboFor2x: 5,
};

export class World {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.rng = Math.random;
    this.reset();
  }

  reset() {
    this.rocks = []; this.bolts = []; this.gems = [];
    this.score = 0; this.lives = this.cfg.lives; this.wave = 0; this.combo = 0;
    this.t = 0; this.nextSpawn = 1.0; this.invulnUntil = 0; this.over = false;
    this.shot = 0; this.collected = 0;
    this._id = 1;
  }

  get mult() { return this.combo >= this.cfg.comboFor2x ? 2 : 1; }
  get invulnerable() { return this.t < this.invulnUntil; }

  /**
   * @param input {P:{x,y}, M:{x,y}, fire:boolean (edge), magnet:boolean (held), eyeZ:number}
   * @param dt    seconds
   * @returns events [{type, x, y, z, ...}]
   */
  step(input, dt) {
    const c = this.cfg, ev = [];
    if (this.over) return ev;
    dt = Math.min(dt, 0.1);
    this.t += dt;

    const wave = Math.floor(this.t / c.waveS);
    if (wave !== this.wave) { this.wave = wave; ev.push({ type: 'wave', wave }); }

    // ---- spawn rocks -----------------------------------------------------------
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.nextSpawn = c.spawnBaseS / (1 + c.spawnPerWave * this.wave);
      this.rocks.push(this._spawnRock(input.P));
    }

    // ---- fire ------------------------------------------------------------------
    if (input.fire) {
      this.bolts.push({ id: this._id++, x: input.P.x, y: input.P.y, z: 0, vz: -c.boltSpeed });
      ev.push({ type: 'fired', x: input.P.x, y: input.P.y, z: 0 });
    }

    // ---- rocks -----------------------------------------------------------------
    for (const r of this.rocks) {
      const zPrev = r.z;
      r.z += r.vz * dt;
      r.spin += dt;
      if (zPrev < 0 && r.z >= 0) {                       // crossing the glass: did it get us?
        const d = Math.hypot(r.x - input.P.x, r.y - input.P.y);
        if (d < r.r + c.playerR) {
          if (!this.invulnerable) {
            this.lives--;
            this.invulnUntil = this.t + c.invulnS;
            this.combo = 0;
            ev.push({ type: 'hit', x: r.x, y: r.y, z: 0, lives: this.lives });
            if (this.lives <= 0) { this.over = true; ev.push({ type: 'over', score: this.score }); }
          }
          r.dead = true;
        } else {
          ev.push({ type: 'dodged', x: r.x, y: r.y, z: 0 });
        }
      }
      if (r.z > 40) r.dead = true;                       // whooshed past the face
    }

    // ---- bolts (swept along z so a fast bolt cannot tunnel through a rock) ----------
    for (const b of this.bolts) {
      const zPrev = b.z;
      b.z += b.vz * dt;
      for (const r of this.rocks) {
        if (r.dead) continue;
        const lateral = Math.hypot(r.x - b.x, r.y - b.y);
        if (lateral < r.r + 1 && r.z <= zPrev && r.z >= b.z) {
          r.dead = true; b.dead = true;
          this.shot++;
          this.score += 10 * this.mult;
          this._burst(r);
          ev.push({ type: 'burst', x: r.x, y: r.y, z: r.z, r: r.r });
          break;
        }
      }
      if (b.z < -c.depth) b.dead = true;
    }

    // ---- gems ------------------------------------------------------------------
    const T = { x: input.M.x, y: input.M.y, z: c.magnetZ };     // the mouth, just in front of the glass
    const cosCone = Math.cos(c.magnetConeDeg * Math.PI / 180);
    const damp = Math.exp(-0.85 * dt);
    for (const g of this.gems) {
      g.age += dt;
      // drift: velocity decays toward a slow float toward the glass
      g.vx *= damp; g.vy *= damp; g.vz = 6 + (g.vz - 6) * damp;
      g.pulled = false;
      if (input.magnet) {
        const dx = T.x - g.x, dy = T.y - g.y, dz = T.z - g.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 1e-3 && dz / dist >= cosCone) {           // inside the cone in front of the mouth
          const a = Math.min(c.magnetAmax, c.magnetK / Math.max(dist, 10) ** 2);
          g.vx += a * dt * dx / dist; g.vy += a * dt * dy / dist; g.vz += a * dt * dz / dist;
          const v = Math.hypot(g.vx, g.vy, g.vz);
          if (v > c.magnetVmax) { const k = c.magnetVmax / v; g.vx *= k; g.vy *= k; g.vz *= k; }
          g.pulled = true;
        }
      }
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;

      const dist = Math.hypot(T.x - g.x, T.y - g.y, T.z - g.z);
      const speed = Math.hypot(g.vx, g.vy, g.vz);
      if (input.magnet && dist < Math.max(c.collectR, speed * dt)) {
        g.dead = true;
        this.collected++; this.combo++;
        this.score += 5 * this.mult;
        ev.push({ type: 'collect', x: g.x, y: g.y, z: g.z, combo: this.combo, mult: this.mult });
      } else if (g.z > input.eyeZ - 8 || g.age > c.gemLifeS) {
        g.dead = true;
        this.combo = 0;
        ev.push({ type: 'miss', x: g.x, y: g.y, z: g.z });
      }
    }

    this.rocks = this.rocks.filter((r) => !r.dead);
    this.bolts = this.bolts.filter((b) => !b.dead);
    this.gems = this.gems.filter((g) => !g.dead);
    return ev;
  }

  _spawnRock(P) {
    const c = this.cfg, rnd = this.rng;
    const r = c.rockRmin + rnd() * (c.rockRmax - c.rockRmin);
    let x, y;
    if (rnd() < 0.5) {                                   // half of them come straight for you
      x = P.x + (rnd() - 0.5) * 10;
      y = P.y + (rnd() - 0.5) * 10;
    } else {
      x = (rnd() * 2 - 1) * c.fieldX;
      y = (rnd() * 2 - 1) * c.fieldY;
    }
    x = Math.max(-c.fieldX, Math.min(c.fieldX, x));
    y = Math.max(-c.fieldY, Math.min(c.fieldY, y));
    const vz = Math.min(c.speedMax, c.speedBase + c.speedPerWave * this.wave);
    return { id: this._id++, x, y, z: -c.depth, r, vz, spin: rnd() * 6, seed: rnd() };
  }

  _burst(rock) {
    const c = this.cfg, rnd = this.rng;
    const n = c.gemsMin + Math.floor(rnd() * (c.gemsMax - c.gemsMin + 1));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rnd() * 0.5, sp = 10 + rnd() * 15;
      this.gems.push({
        id: this._id++, x: rock.x, y: rock.y, z: rock.z,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, vz: -5 + rnd() * 20,
        age: 0, hue: rnd(), pulled: false,
      });
    }
  }
}
