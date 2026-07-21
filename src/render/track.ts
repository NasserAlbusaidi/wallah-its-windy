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
import { categoryRgba } from '../category';
import { clipToLatLon, latLonToClip, offsetKm } from '../grid';
import {
  maxWindRadiusKm,
  windRadiusFromQuadrantsKm,
} from '../structure';
import type { WindRadiiKm } from '../types';
import type { DrawCtx } from './context';

const t = TOKENS.track.rgba01;
const TR = Math.round(t[0] * 255);
const TG = Math.round(t[1] * 255);
const TB = Math.round(t[2] * 255);
const s = TOKENS.stormCore.rgba01;
const SR = Math.round(s[0] * 255);
const SG = Math.round(s[1] * 255);
const SB = Math.round(s[2] * 255);
const accent = TOKENS.accent.rgba01;
const AR = Math.round(accent[0] * 255);
const AG = Math.round(accent[1] * 255);
const AB = Math.round(accent[2] * 255);

function trackRgba(a: number): string {
  return `rgba(${TR},${TG},${TB},${a})`;
}
function coreRgba(a: number): string {
  return `rgba(${SR},${SG},${SB},${a})`;
}
function accentRgba(a: number): string {
  return `rgba(${AR},${AG},${AB},${a})`;
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

  private drawWindRing(
    g: CanvasRenderingContext2D,
    ctx: DrawCtx,
    radii: WindRadiiKm,
    stroke: string,
    lineWidth: number,
    dash: number[],
  ): void {
    const centre = ctx.centerClip;
    if (!centre || maxWindRadiusKm(radii) <= 0) return;
    const origin = clipToLatLon(centre.x, centre.y);
    g.save();
    g.strokeStyle = stroke;
    g.lineWidth = lineWidth;
    g.setLineDash(dash);
    g.lineJoin = 'round';
    g.beginPath();
    for (let step = 0; step <= 72; step++) {
      const bearing = step * 5;
      const angle = (bearing * Math.PI) / 180;
      const radiusKm = windRadiusFromQuadrantsKm(radii, bearing);
      const point = offsetKm(
        origin.lat,
        origin.lon,
        Math.sin(angle),
        Math.cos(angle),
        radiusKm,
      );
      const clip = latLonToClip(point.lat, point.lon);
      const [x, y] = this.px(clip.x, clip.y);
      if (step === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
    g.restore();
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

    // A controlled comparison keeps run one as a complete amber reference while
    // the cyan candidate grows over it. Same genesis + seed; only environment
    // changed, so divergence is readable directly on the map.
    const comparison = ctx.comparisonTrack;
    if (comparison && comparison.length > 1) {
      g.lineWidth = Math.max(1, unit * 0.00135);
      g.setLineDash([unit * 0.002, unit * 0.006]);
      g.lineCap = 'round';
      g.strokeStyle = accentRgba(0.42);
      g.beginPath();
      for (let i = 0; i < comparison.length; i++) {
        const point = latLonToClip(comparison[i].lat, comparison[i].lon);
        const [x, y] = this.px(point.x, point.y);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
    }

    // Physical wind footprint: faint 34-kt extent, brighter hurricane-force
    // extent, and the compact RMW/eyewall ring. These are parametric quadrants
    // from the recorded structure—not a forecast cone or observed wind analysis.
    const structure = ctx.structure;
    if (structure && ctx.centerClip) {
      this.drawWindRing(
        g,
        ctx,
        structure.r34Km,
        trackRgba(0.16 * fade),
        Math.max(1, unit * 0.0008),
        [unit * 0.003, unit * 0.008],
      );
      this.drawWindRing(
        g,
        ctx,
        structure.r64Km,
        coreRgba(0.3 * fade),
        Math.max(1, unit * 0.001),
        [unit * 0.002, unit * 0.004],
      );
      const rmw = {
        ne: structure.rmwKm,
        se: structure.rmwKm,
        sw: structure.rmwKm,
        nw: structure.rmwKm,
      };
      this.drawWindRing(
        g,
        ctx,
        rmw,
        accentRgba(0.34 * fade),
        Math.max(1, unit * 0.0012),
        [],
      );
    }

    // Dotted, age-faded track polyline, coloured by Saffir–Simpson class of
    // each segment (the standard tracker convention) so the storm's history —
    // TD spin-up, peak category, decay — reads directly off the map.
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
        // Older segments (earlier in the array) dimmer. The whole line (base +
        // age term) multiplies by `fade` so it drains smoothly to 0 during the
        // ~10 s aftermath instead of flooring at 0.12 then popping to nothing.
        const ageFrac = i / (track.length - 1);
        g.strokeStyle = categoryRgba(
          track[i].vKt,
          (0.18 + 0.5 * ageFrac) * fade,
        );
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
