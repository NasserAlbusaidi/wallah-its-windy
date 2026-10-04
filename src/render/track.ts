/**
 * track.ts — the storm track + intensity halo, drawn on the 2D overlay canvas.
 *
 * This is crisp vector chrome above the WebGL map: a glowing, age-faded,
 * category-coloured polyline of the storm's path with six-hourly fix beads,
 * a soft intensity halo, and the tropical-cyclone glyph at the centre.
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
import { categoryRgba, stormCategory } from '../category';
import { clipToLatLon, latLonToClip, offsetKm } from '../grid';
import {
  maxWindRadiusKm,
  windRadiusFromQuadrantsKm,
} from '../structure';
import type { ViewTransform, WindRadiiKm } from '../types';
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
const k = TOKENS.oceanDeep.rgba01;
const KR = Math.round(k[0] * 255);
const KG = Math.round(k[1] * 255);
const KB = Math.round(k[2] * 255);
/** Dark keyline under opaque marks, so they separate from bright weather. */
function keylineRgba(a: number): string {
  return `rgba(${KR},${KG},${KB},${a})`;
}

/** Alpha steps along the age-faded track (stroke batching granularity). */
const AGE_BUCKETS = 16;
/** Decorative eye-glyph spin, radians per wall-clock second (display only). */
const GLYPH_TURN_RAD_PER_S = 0.9;

export class TrackLayer {
  private ov: CanvasRenderingContext2D | null = null;
  private w = 1;
  private h = 1;
  private view: ViewTransform | null = null;

  init(overlay: CanvasRenderingContext2D): void {
    this.ov = overlay;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
  }

  /** World clip -> device px through the frame's view (set at draw start). */
  private px(clipX: number, clipY: number): [number, number] {
    const v = this.view;
    const nx = v ? clipX * v.scaleX + v.offsetX : clipX;
    const ny = v ? clipY * v.scaleY + v.offsetY : clipY;
    return [(nx * 0.5 + 0.5) * this.w, (0.5 - ny * 0.5) * this.h];
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
    this.view = ctx.view;
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

    // Age-faded track, coloured by the Saffir–Simpson class of each segment
    // (the standard tracker convention) so TD spin-up, peak and decay read
    // straight off the map: a wide additive glow under a crisp core line.
    const track = ctx.track;
    if (track && track.length > 1) {
      const pts = track.map((p) => {
        const clip = latLonToClip(p.lat, p.lon);
        return this.px(clip.x, clip.y);
      });
      g.lineCap = 'round';
      g.lineJoin = 'round';
      // Older segments (earlier in the array) dimmer; the whole line
      // multiplies by `fade` so it drains smoothly over the aftermath. Runs of
      // segments sharing a category and one of AGE_BUCKETS alpha steps stroke
      // as one path, so a long track costs dozens of strokes, not hundreds.
      const strokePass = (width: number, alpha: (ageFrac: number) => number): void => {
        g.lineWidth = width;
        let runKey = '';
        let runStart = 0;
        const flush = (end: number): void => {
          if (end <= runStart) return;
          const ageFrac = end / (pts.length - 1);
          g.strokeStyle = categoryRgba(track[end].vKt, alpha(ageFrac) * fade);
          g.beginPath();
          g.moveTo(pts[runStart][0], pts[runStart][1]);
          for (let j = runStart + 1; j <= end; j++) g.lineTo(pts[j][0], pts[j][1]);
          g.stroke();
        };
        for (let i = 1; i < pts.length; i++) {
          const bucket = Math.round((i / (pts.length - 1)) * AGE_BUCKETS);
          const key = `${stormCategory(track[i].vKt).id}:${bucket}`;
          if (key !== runKey) {
            flush(i - 1);
            runKey = key;
            runStart = i - 1;
          }
        }
        flush(pts.length - 1);
      };
      strokePass(Math.max(3, unit * 0.009), (a) => 0.03 + 0.07 * a);
      strokePass(Math.max(1, unit * 0.0022), (a) => 0.22 + 0.6 * a);

      // Six-hourly fixes, best-track style: category-filled beads with a dark
      // keyline, the daily ones larger. Drawn opaque (source-over) so the
      // keyline separates them from bright weather beneath.
      g.save();
      g.globalCompositeOperation = 'source-over';
      g.lineWidth = Math.max(1, unit * 0.0011);
      g.strokeStyle = keylineRgba(0.7 * fade);
      for (let i = 1; i < track.length - 1; i++) {
        const hours = track[i].ageH;
        const sixHourly = Math.abs(hours / 6 - Math.round(hours / 6)) < 0.02;
        if (!sixHourly) continue;
        const daily = Math.abs(hours / 24 - Math.round(hours / 24)) < 0.005;
        const ageFrac = i / (track.length - 1);
        g.fillStyle = categoryRgba(track[i].vKt, (0.35 + 0.6 * ageFrac) * fade);
        g.beginPath();
        g.arc(pts[i][0], pts[i][1], Math.max(1.5, unit * (daily ? 0.0042 : 0.0026)), 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.restore();
    }

    // Intensity halo at the centre. Stronger in reduced-motion (it IS the storm).
    const c = ctx.centerClip;
    if (c) {
      const [cx, cy] = this.px(c.x, c.y);
      const radius = unit * (0.02 + 0.05 * ctx.intensity01);
      const peak = (ctx.reduced ? 0.9 : 0.36) * (ctx.demo ? 0.5 : 1) * fade;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, coreRgba(peak));
      grad.addColorStop(0.4, trackRgba(peak * 0.5));
      grad.addColorStop(1, trackRgba(0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, radius, 0, Math.PI * 2);
      g.fill();

      const vKt = ctx.frame.storm?.vKt ?? track?.[track.length - 1]?.vKt ?? 0;
      this.drawCycloneGlyph(g, cx, cy, unit, vKt, ctx, fade);
    }
    g.restore();
  }

  /**
   * The meteorological tropical-cyclone symbol at the eye: a centre disc with
   * two curled arms, category-coloured, turning counter-clockwise (northern
   * hemisphere) at a fixed decorative rate. Hollow below hurricane force,
   * filled at and above it. Reduced motion freezes the spin; the wall-clock
   * angle never reaches physics or recorded output.
   */
  private drawCycloneGlyph(
    g: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    unit: number,
    vKt: number,
    ctx: DrawCtx,
    fade: number,
  ): void {
    const core = Math.max(2.5, unit * 0.0042);
    const arm = core * 3.1;
    const spin = ctx.reduced ? 0 : -(ctx.nowMs / 1000) * GLYPH_TURN_RAD_PER_S;
    const filled = vKt >= 64;
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.translate(cx, cy);
    g.rotate(spin);
    const traceArms = (): void => {
      g.beginPath();
      for (const sign of [1, -1]) {
        // Northern-hemisphere form (an S): the top arm leaves the disc
        // westward and hooks south, the bottom arm mirrors it — each arm
        // points along the counter-clockwise surface flow on its side.
        g.moveTo(0, -sign * core);
        g.bezierCurveTo(
          -sign * arm * 0.55, -sign * core * 1.15,
          -sign * arm * 1.0, -sign * core * 0.25,
          -sign * arm * 0.82, sign * arm * 0.38,
        );
      }
    };
    // Dark keyline first so the glyph reads over white cloud and bright fill.
    g.lineCap = 'round';
    g.strokeStyle = keylineRgba(0.55 * fade);
    g.lineWidth = Math.max(2.5, unit * 0.0042);
    traceArms();
    g.stroke();
    g.beginPath();
    g.arc(0, 0, core + g.lineWidth * 0.3, 0, Math.PI * 2);
    g.stroke();

    g.strokeStyle = categoryRgba(vKt, 0.95 * fade);
    g.lineWidth = Math.max(1.5, unit * 0.0022);
    traceArms();
    g.stroke();
    g.beginPath();
    g.arc(0, 0, core, 0, Math.PI * 2);
    if (filled) {
      g.fillStyle = categoryRgba(vKt, 0.95 * fade);
      g.fill();
    }
    g.stroke();
    // The exact centre stays readable at any intensity.
    g.fillStyle = coreRgba((filled ? 0.25 : 0.9) * fade);
    g.beginPath();
    g.arc(0, 0, Math.max(1, unit * 0.0012), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  dispose(): void {
    this.ov = null;
  }
}
