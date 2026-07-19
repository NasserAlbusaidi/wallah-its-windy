/**
 * track.ts — the storm track + intensity halo, drawn on the 2D overlay canvas.
 *
 * This is crisp vector chrome above the WebGL map: a dotted, age-faded polyline
 * of the storm's path (track token) plus a soft intensity halo at the centre.
 * It is ALSO the prefers-reduced-motion representation of the storm — when the
 * particle swarm is skipped, the track + a stronger halo stand in for it
 * (design a11y floor). During aftermath the whole overlay multiplies its alpha
 * by ctx.aftermath so the track lingers and fades over ~10 s alongside the
 * draining flood glow.
 *
 * All coordinate math routes through grid.ts (latLonToClip); px conversion uses
 * the device-pixel canvas size so line weights stay crisp on HiDPI.
 */

import { TOKENS } from '../tokens';
import { latLonToClip } from '../grid';
import type { DrawCtx } from './context';

const t = TOKENS.track.rgba01;
const TR = Math.round(t[0] * 255);
const TG = Math.round(t[1] * 255);
const TB = Math.round(t[2] * 255);
const s = TOKENS.stormCore.rgba01;
const SR = Math.round(s[0] * 255);
const SG = Math.round(s[1] * 255);
const SB = Math.round(s[2] * 255);

function trackRgba(a: number): string {
  return `rgba(${TR},${TG},${TB},${a})`;
}
function coreRgba(a: number): string {
  return `rgba(${SR},${SG},${SB},${a})`;
}

export class TrackLayer {
  private ov: CanvasRenderingContext2D | null = null;
  private w = 1;
  private h = 1;

  init(overlay: CanvasRenderingContext2D): void {
    this.ov = overlay;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
  }

  private px(clipX: number, clipY: number): [number, number] {
    return [(clipX * 0.5 + 0.5) * this.w, (0.5 - clipY * 0.5) * this.h];
  }

  draw(ctx: DrawCtx): void {
    const g = this.ov;
    if (!g) return;
    const fade = ctx.aftermath;
    if (fade <= 0.001) return;
    // Unit for resolution-independent weights (relative to canvas height).
    const unit = this.h;

    g.save();
    g.globalCompositeOperation = 'lighter';

    // Dotted, age-faded track polyline.
    const track = ctx.track;
    if (track && track.length > 1) {
      g.lineWidth = Math.max(1, unit * 0.0018);
      g.setLineDash([unit * 0.004, unit * 0.008]);
      g.lineCap = 'round';
      for (let i = 1; i < track.length; i++) {
        const a = latLonToClip(track[i - 1].lat, track[i - 1].lon);
        const b = latLonToClip(track[i].lat, track[i].lon);
        const [ax, ay] = this.px(a.x, a.y);
        const [bx, by] = this.px(b.x, b.y);
        // Older segments (earlier in the array) dimmer.
        const ageFrac = i / (track.length - 1);
        g.strokeStyle = trackRgba(0.12 + 0.5 * ageFrac * fade);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
      g.setLineDash([]);
    }

    // Intensity halo at the centre. Stronger in reduced-motion (it IS the storm).
    const c = ctx.centerClip;
    if (c) {
      const [cx, cy] = this.px(c.x, c.y);
      const radius = unit * (0.02 + 0.05 * ctx.intensity01);
      const peak = (ctx.reduced ? 0.9 : 0.5) * (ctx.demo ? 0.5 : 1) * fade;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, coreRgba(peak));
      grad.addColorStop(0.4, trackRgba(peak * 0.5));
      grad.addColorStop(1, trackRgba(0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, radius, 0, Math.PI * 2);
      g.fill();

      // A crisp eye dot so the exact centre reads even at low intensity.
      g.fillStyle = coreRgba(0.8 * peak + 0.15 * fade);
      g.beginPath();
      g.arc(cx, cy, Math.max(1, unit * 0.0015), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  dispose(): void {
    this.ov = null;
  }
}
