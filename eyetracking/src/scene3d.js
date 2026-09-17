// scene3d.js — the 3D environment behind (and slightly in front of) the glass.
//
// The scene is a .glb, authored in centimetres with the window at z = 0 and the room
// running back into −z. Replace `assets/scene.glb` — or point `scene.glb` in config.json
// at another file — and the app renders that instead. tools/make_scene.py builds the
// default room. If the file is missing or fails to parse, a procedural stand-in room is
// built so the renderer can still be tested.
//
// Two groups, decided by the top-level node name:
//
//   room    everything else. Aimed at where the viewer actually sits — see aim().
//   Glass*  nodes whose name starts with "Glass" are anchored to the window instead, and
//           are authored in window coordinates: x and y are roughly where the object should
//           appear on the glass from the resting position, z is how far it floats in front
//           of it. These are the things meant to poke out of the monitor.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MAX_AIM_DEG = 35;    // past this the room's front rim tips far enough to show its outside

export class Scene3D {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.room = new THREE.Group();
    this.glass = new THREE.Group();
    this.scene.add(this.room, this.glass);
    this.status = 'not loaded';
    this.bounds = null;
    this.glassZ = 0;         // mean depth of the window-anchored nodes, cm in front of the glass
    this.aimRad = 0;
    this.aimEnabled = true;
    this._addLights();
  }

  _addLights() {
    this.scene.add(new THREE.HemisphereLight(0xb4c8ea, 0x59616f, 1.4));
    const key = new THREE.DirectionalLight(0xfff3e0, 1.6);
    key.position.set(40, 60, 30);
    key.target.position.set(0, -10, -70);
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0x7fa8ff, 0.7);
    fill.position.set(-50, 10, -20);
    this.scene.add(fill);
    // travels away from the viewer, so the back wall and every face pointing at the
    // glass is lit rather than reading as a hole
    const back = new THREE.DirectionalLight(0xcfe0ff, 0.9);
    back.position.set(0, 12, 40);
    back.target.position.set(0, -4, -150);
    this.scene.add(back, back.target);
    // bounce off the floor, so the ceiling is not a black slab above the window
    const bounce = new THREE.DirectionalLight(0x93a6c8, 0.55);
    bounce.position.set(0, -40, -30);
    bounce.target.position.set(0, 29, -70);
    this.scene.add(bounce, bounce.target);
    // a little light at the glass so anything popping out of the window is lit from the front
    const front = new THREE.PointLight(0xffd9a0, 900, 120, 2);
    front.position.set(-6, 14, 22);
    this.scene.add(front);
  }

  async load(url = 'assets/scene.glb') {
    let content;
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      content = gltf.scene;
      this.status = url;
    } catch (e) {
      console.warn('scene .glb failed to load, using the built-in room', e);
      content = fallbackRoom();
      this.status = `${url} not loaded (${e.message || e}) — built-in room`;
    }
    content.traverse((o) => {
      if (o.isMesh || o.isLine) o.frustumCulled = false;   // the frustum is exotic; culling is not worth the risk
    });
    for (const node of [...content.children]) {
      (node.name.startsWith('Glass') ? this.glass : this.room).add(node);
    }
    this.bounds = new THREE.Box3().setFromObject(this.room);
    this.glassZ = this.glass.children.length
      ? new THREE.Box3().setFromObject(this.glass).getCenter(new THREE.Vector3()).z
      : 0;
    return this.status;
  }

  /**
   * Point the room at where the viewer actually sits.
   *
   * A window whose centre is below your eyes is a window you look *down* through: with the
   * room hung square on the screen you see its floor and nothing else, which is correct and
   * useless. No translation fixes that — shifting the room only slides the image along the
   * glass. Tilting it does: rotate the room about the window centre until its axis points
   * at the resting eye, and looking down through the glass then looks straight into the
   * middle of the room, like a shop window display tipped toward you.
   *
   * `eye` is the *resting* position measured during calibration, never the live one —
   * aiming at the live position would cancel the parallax exactly, which is the whole
   * effect. Window-anchored nodes are not rotated; they are nudged by the fraction of the
   * eye offset that keeps them where they were authored to appear on the glass.
   */
  aim(eye) {
    if (!this.aimEnabled || !eye) return;
    const z = Math.max(1, eye.z);
    const limit = MAX_AIM_DEG * Math.PI / 180;
    this.aimRad = Math.max(-limit, Math.min(limit, -Math.atan2(eye.y, z)));
    this.room.rotation.x = this.aimRad;
    this.glass.position.y = eye.y * (this.glassZ / z);
  }

  get aimDeg() { return -this.aimRad * 180 / Math.PI; }

  /**
   * Depth (cm, ≤ 0) of the plane held still on screen — docs/DESIGN.md §2.6.
   * `frac` runs from 0 (the glass, the exact window) to 1 (the far end of the room).
   */
  anchorDepth(frac) {
    if (!this.bounds) return 0;
    return Math.min(0, this.bounds.min.z) * Math.max(0, Math.min(1, frac));
  }

  describe() {
    if (!this.bounds) return this.status;
    const s = this.bounds.getSize(new THREE.Vector3());
    return `${this.status} · ${s.x.toFixed(0)}×${s.y.toFixed(0)}×${s.z.toFixed(0)} cm`;
  }
}

// A minimal room in the same idiom as the .glb, so a missing asset is a degraded view,
// not a black screen.
function fallbackRoom() {
  const g = new THREE.Group();
  const X = 46, Y = 29, ZB = -150;
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.95, side: THREE.BackSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(X * 2, Y * 2, -ZB), mat);
  room.position.set(0, 0, ZB / 2);
  room.name = 'Room';
  g.add(room);

  const grid = new THREE.GridHelper(X * 2, 10, 0x7090c0, 0x40546f);
  grid.position.set(0, -Y, ZB / 2);
  grid.scale.z = -ZB / (X * 2);
  grid.name = 'Grid';
  g.add(grid);

  const cube = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 9),
    new THREE.MeshStandardMaterial({ color: 0x33bfb8, roughness: 0.7 }));
  cube.position.set(-17, -24, -30);
  cube.name = 'Objects';
  const ball = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xdb4d57, roughness: 0.5 }));
  ball.position.set(15, -22, -56);
  ball.name = 'Objects2';
  const pop = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.2, 4.2),
    new THREE.MeshStandardMaterial({ color: 0xff8c26, emissive: 0x552a08, roughness: 0.5 }));
  pop.position.set(-6.5, 2.0, 12);
  pop.name = 'GlassCube';
  g.add(cube, ball, pop);
  return g;
}
