// projection.js — off-axis ("generalised perspective", Kooima 2008) projection.
//
// The screen rectangle is fixed in world space at z = 0; the camera sits at the eye
// position and the frustum is skewed so that its four side planes always pass exactly
// through the screen corners. That is what makes the screen edges behave like a window
// frame instead of a moving viewport.
//
// three.js ships the same maths as CameraUtils.frameCorners, which also orients the
// camera to the screen plane. The explicit form is in docs/DESIGN.md §5.
//
// `shift` slides the virtual screen rectangle laterally with the head. Zero is the exact
// window. Non-zero is a deliberate departure: the whole image is translated so that a
// chosen depth plane — the back wall, say — stays put on the screen instead of the glass
// plane. Relative parallax between depths is untouched, because the camera still sits at
// the true eye; only the uniform slide of the picture changes. docs/DESIGN.md §2.6.

import { frameCorners } from 'three/addons/utils/CameraUtils.js';
import { Vector3 } from 'three';

const NEAR = 1;      // cm
const FAR = 1000;    // cm

const bl = new Vector3(), br = new Vector3(), tl = new Vector3();

/**
 * @param camera  THREE.PerspectiveCamera
 * @param eye     {x, y, z} in screen space, cm, z > 0
 * @param rect    from ScreenGeometry.rect()
 * @param offset  extra shift applied to the eye, used for the per-eye pair in M4
 * @param shift   {x, y} slide of the screen rectangle, cm — the anchor-plane correction
 */
export function applyOffAxis(camera, eye, rect, offset = null, shift = null) {
  const ex = eye.x + (offset ? offset.x : 0);
  const ey = eye.y + (offset ? offset.y : 0);
  const ez = Math.max(NEAR + 0.1, eye.z + (offset ? offset.z : 0));
  const sx = shift ? shift.x : 0, sy = shift ? shift.y : 0;

  camera.near = NEAR;
  camera.far = FAR;
  camera.position.set(ex, ey, ez);

  bl.set(-rect.halfW + sx, -rect.halfH + sy, 0);
  br.set(rect.halfW + sx, -rect.halfH + sy, 0);
  tl.set(-rect.halfW + sx, rect.halfH + sy, 0);
  frameCorners(camera, bl, br, tl, true);   // true: also estimate fov, so shadows/helpers behave
  camera.updateMatrixWorld();
  return camera;
}

/**
 * How far the screen rectangle must slide so the plane at `depth` (cm, negative behind
 * the glass) holds still while the head is `d` away from its resting position.
 * A plane at depth z moves on screen by (1 − t)·d with t = ez / (ez − z); this cancels it.
 */
export function anchorShift(d, ez, depth) {
  const t = ez / Math.max(1e-3, ez - depth);
  return { x: (1 - t) * d.x, y: (1 - t) * d.y, t };
}
