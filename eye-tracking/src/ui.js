// ui.js — screens, HUD, camera preview, toasts. No app logic lives here; main.js and
// calibrate.js drive it.

import { IRIS_L, IRIS_R } from './tracker.js';

export const $ = (id) => document.getElementById(id);

/** Show one overlay screen (any `.screen` inside #ui), or null for the viewer (overlay hidden). */
export function showScreen(id) {
  for (const s of document.querySelectorAll('#ui .screen')) s.classList.toggle('hidden', s.id !== id);
  $('ui').classList.toggle('hidden', !id);
  $('hud').classList.toggle('hidden', !!id);
  return id;
}

export function showError(text) {
  $('errText').textContent = text;
  showScreen('s-error');
}

let toastTimer = 0;
export function toast(msg, ms = 1400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

export function setLost(on) { $('lost').classList.toggle('hidden', !on); }

/** Click delegation for every [data-act] button on the page. */
export function bindActions(handlers) {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const fn = handlers[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b); }
  });
}

// ---------------------------------------------------------------- camera preview
export class Preview {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d');
    this.on = false;
    this.width = 220;
  }

  setVisible(on) {
    this.on = on;
    this.canvas.classList.toggle('hidden', !on);
  }

  setWidth(w) {
    this.width = Math.max(120, Math.min(520, Math.round(w)));
    const vw = this.video.videoWidth || 4, vh = this.video.videoHeight || 3;
    this.canvas.width = this.width;
    this.canvas.height = Math.round(this.width * vh / vw);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.canvas.height + 'px';
  }

  draw(landmarks, faceFound) {
    if (!this.on) return;
    const { canvas: c, ctx, video: v } = this;
    if (!v.videoWidth) return;
    if (Math.abs(c.height / c.width - v.videoHeight / v.videoWidth) > 0.02) this.setWidth(this.width);
    const vw = v.videoWidth, vh = v.videoHeight;
    const k = Math.max(c.width / vw, c.height / vh);       // centre-crop, never stretch
    const sw = c.width / k, sh = c.height / k;
    const ox = (vw - sw) / 2, oy = (vh - sh) / 2;
    ctx.drawImage(v, ox, oy, sw, sh, 0, 0, c.width, c.height);

    if (landmarks) {
      const px = (p) => [(p.x * vw - ox) * k, (p.y * vh - oy) * k];
      ctx.fillStyle = 'rgba(125,255,179,.75)';
      for (let i = 0; i < landmarks.length; i += 3) {
        const [x, y] = px(landmarks[i]);
        ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
      ctx.fillStyle = '#7dc4ff';
      for (const i of [IRIS_L, IRIS_R]) {
        const [x, y] = px(landmarks[i]);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      }
      const [lx, ly] = px(landmarks[IRIS_L]), [rx, ry] = px(landmarks[IRIS_R]);
      ctx.strokeStyle = 'rgba(125,196,255,.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke();
    }
    this.canvas.style.borderColor = faceFound ? '#7dffb3' : '#ff6b8b';
  }
}

// ---------------------------------------------------------------- HUD
export function setHud(html) { $('hud').innerHTML = html; }
