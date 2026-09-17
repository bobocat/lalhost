// camera.js — getUserMedia into a <video>, plus "is there a new frame?" detection.
// Ported from Face Pilot (C:\git\face-game), with requestVideoFrameCallback added:
// it fires as soon as a frame is presented, which shaves a few ms off the tracking latency.

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.error = null;
    this._pending = false;       // a frame arrived that the tracker has not consumed yet
    this._lastTime = -1;         // fallback path: last video.currentTime we ran on
    this._rvfc = typeof video.requestVideoFrameCallback === 'function';
    this.frameTime = 0;          // performance.now() of the newest frame
  }

  async start({ width = 640, height = 480 } = {}) {
    this.error = null;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: width }, height: { ideal: height }, facingMode: 'user' },
        audio: false,
      });
    } catch (e) {
      this.error = 'Camera access was denied or no camera was found. (' + (e.message || e) + ')';
      throw new Error(this.error);
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    if (this._rvfc) this._queue();
    return this.settings();
  }

  _queue() {
    this.video.requestVideoFrameCallback(() => {
      this._pending = true;
      this.frameTime = performance.now();
      this._queue();
    });
  }

  // True once per captured frame. Consuming it clears the flag.
  hasNewFrame() {
    const v = this.video;
    if (document.hidden || v.readyState < 2) return false;
    if (this._rvfc) {
      if (!this._pending) return false;
      this._pending = false;
      return true;
    }
    if (v.currentTime === this._lastTime) return false;
    this._lastTime = v.currentTime;
    this.frameTime = performance.now();
    return true;
  }

  settings() {
    const t = this.stream && this.stream.getVideoTracks()[0];
    const s = t ? t.getSettings() : {};
    return {
      width: this.video.videoWidth || s.width || 0,
      height: this.video.videoHeight || s.height || 0,
      frameRate: s.frameRate || 0,
      label: t ? t.label : '',
    };
  }

  get running() { return !!this.stream; }

  stop() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }
}
