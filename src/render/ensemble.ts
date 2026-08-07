/**
 * ensemble.ts — the ensemble uncertainty overlay (UX v2 phase 4).
 *
 * A Canvas2D layer drawn between GhostLayer and TrackLayer in the facade's
 * luminance order: broader and dimmer than the live storm track, brighter
 * than the static historic ghosts. Three geo-anchored products:
 *
 *   1. the perturbation-frequency grid (accent-tinted, screen-composited
 *      cells — the fraction of members whose centre visited each cell),
 *   2. the percentile track envelope ribbon (default on: fill + outline in
 *      the ensembleEnvelope token),
 *   3. member track polylines (on demand only — setShowMembers).
 *
 * All projection goes lat/lon -> grid.latLonToClip (domain-fixed world clip)
 * -> the per-frame ViewTransform. The envelope polygon arrives precomputed
 * (src/ensemble-envelope.ts, once per result); this layer only re-projects
 * it. Wording rule: everything here is perturbation FREQUENCY, never
 * probability (HF-4 gate rejection binding).
 */

import { TOKENS } from '../tokens';
import { DOMAIN, cellToLatLon, latLonToClip } from '../grid';
import type { EnsembleResult } from '../ensemble';
import type { EnsembleEnvelope } from '../ensemble-envelope';
import type { ViewTransform } from '../types';

const accent = TOKENS.accent.rgba01;
const AR = Math.round(accent[0] * 255);
const AG = Math.round(accent[1] * 255);
const AB = Math.round(accent[2] * 255);
const trackTone = TOKENS.track.rgba01;
const TR = Math.round(trackTone[0] * 255);
const TG = Math.round(trackTone[1] * 255);
const TB = Math.round(trackTone[2] * 255);
const envTone = TOKENS.ensembleEnvelope.rgba01;
const ER = Math.round(envTone[0] * 255);
const EG = Math.round(envTone[1] * 255);
const EB = Math.round(envTone[2] * 255);
/** Envelope fill alpha comes from the token; the outline reads stronger. */
const ENVELOPE_FILL_ALPHA = envTone[3];
const ENVELOPE_OUTLINE_ALPHA = Math.min(1, envTone[3] * 3);

/** Cells visited by fewer than this member fraction stay dark. */
const GRID_MIN_FREQUENCY = 0.025;
/** Member spaghetti alpha — well below the live track's 0.18+ range. */
const MEMBER_ALPHA = 0.13;

export class EnsembleLayer {
  private ov: CanvasRenderingContext2D | null = null;
  private w = 1;
  private h = 1;
  private result: EnsembleResult | null = null;
  private envelope: EnsembleEnvelope | null = null;
  private showMembers = false;
  private view: ViewTransform | null = null;

  init(overlay: CanvasRenderingContext2D): void {
    this.ov = overlay;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
  }

  /** Replace (or clear) the active ensemble product. Envelope is optional —
   * a run whose members die too fast for two leads still shows its grid. */
  setEnsemble(
    result: EnsembleResult | null,
    envelope: EnsembleEnvelope | null,
  ): void {
    this.result = result;
    this.envelope = result ? envelope : null;
  }

  /** Member spaghetti is on-demand (ROADMAP: envelope default, members on request). */
  setShowMembers(visible: boolean): void {
    this.showMembers = visible;
  }

  /** World clip -> device px through the frame's view (set at draw start). */
  private px(clipX: number, clipY: number): [number, number] {
    const v = this.view;
    const nx = v ? clipX * v.scaleX + v.offsetX : clipX;
    const ny = v ? clipY * v.scaleY + v.offsetY : clipY;
    return [(nx * 0.5 + 0.5) * this.w, (0.5 - ny * 0.5) * this.h];
  }

  private geoPx(lat: number, lon: number): [number, number] {
    const c = latLonToClip(lat, lon);
    return this.px(c.x, c.y);
  }

  draw(view: ViewTransform): void {
    const ctx = this.ov;
    this.view = view;
    const result = this.result;
    if (!ctx || !result) return;
    const unit = this.h; // resolution-independent weight base (mirrors TrackLayer)

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // 1. Frequency grid: geo-anchored cells, alpha ramped by member fraction.
    const { nx, ny, probability } = result.grid;
    const spec = { nx, ny, bbox: DOMAIN };
    for (let index = 0; index < probability.length; index++) {
      const frequency = probability[index];
      if (frequency < GRID_MIN_FREQUENCY) continue;
      const col = index % nx;
      const row = Math.floor(index / nx);
      // Cell corners: centres sit at integer (col,row); corners at ±0.5.
      const nw = cellToLatLon(spec, col - 0.5, row - 0.5);
      const se = cellToLatLon(spec, col + 0.5, row + 0.5);
      const [ax, ay] = this.geoPx(nw.lat, nw.lon);
      const [bx, by] = this.geoPx(se.lat, se.lon);
      ctx.fillStyle =
        `rgba(${AR},${AG},${AB},` +
        `${Math.min(0.28, 0.025 + frequency * 0.32)})`;
      ctx.fillRect(ax, ay, bx - ax + 1, by - ay + 1);
    }

    // 2. Percentile envelope ribbon (the default-on product).
    const envelope = this.envelope;
    if (envelope && envelope.polygon.length > 2) {
      ctx.beginPath();
      for (let i = 0; i < envelope.polygon.length; i++) {
        const p = envelope.polygon[i];
        const [x, y] = this.geoPx(p.lat, p.lon);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${ER},${EG},${EB},${ENVELOPE_FILL_ALPHA})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${ER},${EG},${EB},${ENVELOPE_OUTLINE_ALPHA})`;
      ctx.lineWidth = Math.max(1, unit * 0.0014);
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 3. Member spaghetti — on demand only.
    if (this.showMembers) {
      ctx.strokeStyle = `rgba(${TR},${TG},${TB},${MEMBER_ALPHA})`;
      ctx.lineWidth = Math.max(0.6, unit * 0.0004);
      for (const member of result.members) {
        if (member.track.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < member.track.length; i++) {
          const point = member.track[i];
          const [x, y] = this.geoPx(point.lat, point.lon);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  dispose(): void {
    this.ov = null;
    this.result = null;
    this.envelope = null;
    this.showMembers = false;
  }
}
