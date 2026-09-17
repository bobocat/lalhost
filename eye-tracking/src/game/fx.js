// fx.js — draws the world (docs/GAME.md §4.5) and makes the noises. Entities live in the
// room's own frame, so everything here is a child of scene3d.room and inherits the aim.

import * as THREE from 'three';

const ROCK_MAT = new THREE.MeshStandardMaterial({ color: 0xaab0bd, roughness: 0.85, flatShading: true });
const BOLT_MAT = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
const RING_MAT = new THREE.MeshBasicMaterial({ color: 0x7dc4ff, transparent: true, opacity: 0.28 });
const DOT_MAT = new THREE.MeshBasicMaterial({ color: 0xff9ac4, transparent: true, opacity: 0.45 });
const GEM_GEO = new THREE.OctahedronGeometry(2.2, 0);
const BOLT_GEO = new THREE.CylinderGeometry(0.5, 0.5, 8, 8).rotateX(Math.PI / 2);

export class Fx {
  constructor(scene3d) {
    this.group = new THREE.Group();
    scene3d.room.add(this.group);
    this.meshes = new Map();       // entity id → mesh
    this.rockGeos = new Map();     // id → geometry (disposed with the rock)
    this.flashes = [];             // {mesh, until}

    this.ring = new THREE.Mesh(new THREE.RingGeometry(4, 4.35, 48), RING_MAT);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), DOT_MAT);
    this.group.add(this.ring, this.dot);
    const glow = new THREE.PointLight(0xffe0a0, 0, 60, 2);      // lit briefly on a burst
    this.glow = glow;
    this.group.add(glow);
  }

  sync(world, P, M, now) {
    const seen = new Set();
    for (const r of world.rocks) { seen.add(r.id); this._rock(r); }
    for (const b of world.bolts) { seen.add(b.id); this._bolt(b); }
    for (const g of world.gems) { seen.add(g.id); this._gem(g, now); }
    for (const [id, m] of this.meshes) {
      if (seen.has(id)) continue;
      this.group.remove(m);
      const geo = this.rockGeos.get(id);
      if (geo) { geo.dispose(); this.rockGeos.delete(id); }
      if (m.material !== ROCK_MAT && m.material !== BOLT_MAT) m.material.dispose();
      this.meshes.delete(id);
    }
    this.ring.position.set(P.x, P.y, 0.5);
    this.dot.position.set(M.x, M.y, 0.6);
    this.ring.visible = true;
    this.flashes = this.flashes.filter((f) => {
      if (now < f.until) { f.mesh.scale.multiplyScalar(1.12); f.mesh.material.opacity *= 0.85; return true; }
      this.group.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); return false;
    });
    if (this.glow.intensity > 0) this.glow.intensity *= 0.8;
  }

  _rock(r) {
    let m = this.meshes.get(r.id);
    if (!m) {
      const geo = new THREE.IcosahedronGeometry(r.r, 0);
      const pos = geo.attributes.position;                     // knock the vertices about so no two rocks match
      for (let i = 0; i < pos.count; i++) {
        const k = 0.75 + 0.5 * frac(r.seed * 97.31 + i * 13.7);
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      m = new THREE.Mesh(geo, ROCK_MAT);
      this.rockGeos.set(r.id, geo);
      this.meshes.set(r.id, m);
      this.group.add(m);
    }
    m.position.set(r.x, r.y, r.z);
    m.rotation.set(r.spin * 0.9, r.spin * 1.3, r.seed * 6);
  }

  _bolt(b) {
    let m = this.meshes.get(b.id);
    if (!m) { m = new THREE.Mesh(BOLT_GEO, BOLT_MAT); this.meshes.set(b.id, m); this.group.add(m); }
    m.position.set(b.x, b.y, b.z);
  }

  _gem(g, now) {
    let m = this.meshes.get(g.id);
    if (!m) {
      const color = new THREE.Color().setHSL(g.hue, 0.85, 0.6);
      m = new THREE.Mesh(GEM_GEO, new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.2 }));
      this.meshes.set(g.id, m);
      this.group.add(m);
    }
    m.position.set(g.x, g.y, g.z);
    m.rotation.y = now * 0.004 + g.hue * 6;
    m.material.emissiveIntensity = g.pulled ? 1.2 : 0.35;
    const s = g.z > 0 ? 1 + g.z / 6 : 1;                        // swell as it comes through the glass
    m.scale.setScalar(s);
  }

  /** A quick expanding shell where a rock burst, plus a flicker of light. */
  burst(e, now) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(e.r + 1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.8 }));
    mesh.position.set(e.x, e.y, e.z);
    this.group.add(mesh);
    this.flashes.push({ mesh, until: now + 220 });
    this.glow.position.set(e.x, e.y, e.z);
    this.glow.intensity = 1500;
  }

  setPlayerVisible(on) { this.ring.visible = on; this.dot.visible = on; }

  /** Deep space instead of the room: a shell of distant stars, well inside the far plane. */
  starfield(scene, n = 2600, radius = 850) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // uniform on a sphere, but never behind the viewer's head
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const x = r * Math.cos(th), y = u, z = -Math.abs(r * Math.sin(th));
      pos.set([x * radius, y * radius, z * radius - 100], i * 3);
      const b = 0.35 + Math.random() ** 2.5 * 0.65;                  // a few bright, most faint
      const warm = Math.random();
      col.set([b * (0.85 + 0.15 * warm), b * (0.9 + 0.05 * warm), b * (1.0 - 0.2 * warm)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    stars.frustumCulled = false;
    scene.add(stars);
    scene.background = new THREE.Color(0x000004);
    return stars;
  }
}

const frac = (x) => x - Math.floor(x);

// ---------------------------------------------------------------- sound
export class Sfx {
  constructor() { this.ctx = null; this.on = true; }
  _ac() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.on = false; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  tone(freq, dur, type = 'sine', gain = 0.06, slide = 0) {
    if (!this.on) return;
    const ac = this._ac(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ac.currentTime + dur);
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0005, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  fire() { this.tone(880, 0.09, 'square', 0.04, -500); }
  burst() { this.tone(160, 0.3, 'sawtooth', 0.12, -90); this.tone(420, 0.12, 'square', 0.05, -200); }
  collect(n = 1) { this.tone(660 + Math.min(n, 12) * 40, 0.08, 'sine', 0.06, 300); }
  hit() { this.tone(110, 0.5, 'sawtooth', 0.16, -60); }
  dodge() { this.tone(300, 0.06, 'sine', 0.025, 120); }
  wave() { this.tone(523, 0.12, 'triangle', 0.06); setTimeout(() => this.tone(784, 0.18, 'triangle', 0.06), 130); }
  over() { this.tone(220, 0.6, 'sawtooth', 0.12, -150); }
}
