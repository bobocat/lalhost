// headpose.js — image space (capture pixels) to screen space (cm), docs/DESIGN.md §2.2.
//
//   s_corr = s / cos(yaw)                 undo the foreshortening of a turned head
//   Z      = f_px · IPD_cm / s_corr       pinhole: apparent size falls off with distance
//   X_cam  =  (u − cx) / f_px · Z
//   Y_cam  = −(v − cy) / f_px · Z
//   ex = −X_cam + camX                    the camera faces the viewer, so image right is viewer left
//   ey =  Y_cam + camY
//   ez =  Z     + camZ
//
// f_px comes from calibration: one capture at a known distance fixes the webcam's focal
// length in pixels, which is all the intrinsics we need.

export const YAW_FREEZE_DEG = 30;    // beyond this the cos() correction is unreliable

export function focalFromCapture({ ipdPx, distanceCm, ipdMm }) {
  return (ipdPx * distanceCm) / (ipdMm / 10);
}

/**
 * @param sample  {u, v, ipdPx, yaw} in capture pixels / radians
 * @param frame   {width, height} of the capture
 * @param cal     {fPx, ipdMm, captureWidth}
 * @param camPos  webcam position in screen space, from ScreenGeometry.cameraPosition()
 * @param state   carried between calls so distance can be frozen through a big head turn
 */
export function headPose(sample, frame, cal, camPos, state = {}) {
  // f_px scales with capture width: calibrate at 640 and switch to 1280 and it still holds
  const scale = cal.captureWidth ? frame.width / cal.captureWidth : 1;
  const fPx = cal.fPx * scale;
  const ipdCm = (cal.ipdMm || 63) / 10;

  const yaw = Number.isFinite(sample.yaw) ? sample.yaw : 0;
  const deg = Math.abs(yaw) * 180 / Math.PI;
  let z, frozen = false;
  if (deg > YAW_FREEZE_DEG && Number.isFinite(state.lastZ)) {
    z = state.lastZ;                                   // hold the last good distance
    frozen = true;
  } else {
    const corr = Math.min(1, Math.max(0.5, Math.cos(yaw)));
    z = (fPx * ipdCm) / Math.max(1e-3, sample.ipdPx / corr);
    state.lastZ = z;
  }

  const cx = frame.width / 2, cy = frame.height / 2;
  const xCam = (sample.u - cx) / fPx * z;
  const yCam = -(sample.v - cy) / fPx * z;

  return {
    x: -xCam + camPos.x,
    y: yCam + camPos.y,
    z: z + camPos.z,
    yawDeg: deg,
    frozen,
  };
}

/** Median of the IPD samples gathered during calibration — robust to the odd bad frame. */
export function median(values) {
  if (!values.length) return 0;
  const a = [...values].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
