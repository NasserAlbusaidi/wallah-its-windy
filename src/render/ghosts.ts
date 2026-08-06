/**
 * ghosts.ts — the historic-storm "ghost" tracks, drawn on the 2D overlay (C7).
 *
 * A dim, static counterpart to {@link TrackLayer}: instead of the single live
 * storm's dotted, age-faded, aftermath-gated path, this draws the fixed IBTrACS
 * catalogue polylines as faint long-dashed lines that are ALWAYS
 * present — they are the historical backdrop the user's storm is measured against.
 *
 * It mirrors TrackLayer deliberately: a Canvas2D layer on the overlay context
 * (init takes the 2D context, NOT gl), additive 'lighter' compositing, all
 * projection through grid.ts (latLonToClip) then its own clip->device-px step.
 * Differences that keep it from competing with the live track (luminance rule):
 *   - drawn BEFORE track.draw in the facade (dimmer = earlier),
 *   - a constant faint alpha from the ghostTrack token (no ageFrac, no aftermath),
 *   - long dashes vs the live track's short dots (visually distinct),
 *   - UNCONDITIONAL: never gated on aftermath/centerClip, so ghosts stay visible
 *     when no storm is alive.
 * The active scenario's ghost draws at ~2x alpha (still below the live track).
 */

import { TOKENS } from '../tokens';
import { latLonToClip } from '../grid';
import type { GhostPolyline } from '../tracks';
import type { ViewTransform } from '../types';

const g = TOKENS.ghostTrack.rgba01;
const GR = Math.round(g[0] * 255);
const GG = Math.round(g[1] * 255);
const GB = Math.round(g[2] * 255);
/** Base alpha for an inactive ghost = the token's alpha (genesis-glow luminance). */
const GHOST_ALPHA = g[3];

function ghostRgba(a: number): string {
  return `rgba(${GR},${GG},${GB},${a})`;
}

export class GhostLayer {
  private ov: CanvasRenderingContext2D | null = null;
  private w = 1;
  private h = 1;
  private tracks: GhostPolyline[] = [];
  private activeId: string | null = null;

  init(overlay: CanvasRenderingContext2D): void {
    this.ov = overlay;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
  }

  /** Replace the ghost polylines (static IBTrACS tracks). */
  setTracks(tracks: GhostPolyline[]): void {
    this.tracks = tracks;
  }

  /** Highlight one ghost (the active scenario) at ~2x alpha; null clears it. */
  setActiveGhostId(id: string | null): void {
    this.activeId = id;
  }

  private view: ViewTransform | null = null;

  /** World clip -> device px through the frame's view (set at draw start). */
  private px(clipX: number, clipY: number): [number, number] {
    const v = this.view;
    const nx = v ? clipX * v.scaleX + v.offsetX : clipX;
    const ny = v ? clipY * v.scaleY + v.offsetY : clipY;
    return [(nx * 0.5 + 0.5) * this.w, (0.5 - ny * 0.5) * this.h];
  }

  /**
   * Draw every ghost polyline. Unconditional — no aftermath/centerClip gate, so
   * ghosts persist whether or not a live storm exists. Off-domain fixes are drawn
   * anyway; the canvas clips them (C1). Re-strokes each frame (the overlay is
   * cleared every frame by both main and the facade — no retained 2D state).
   */
  draw(view: ViewTransform): void {
    const ctx = this.ov;
    this.view = view;
    if (!ctx || this.tracks.length === 0) return;
    const unit = this.h; // resolution-independent weight base (mirrors TrackLayer)

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1, unit * 0.0016);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Long dashes distinguish the historic ghost from the live dotted track.
    ctx.setLineDash([unit * 0.02, unit * 0.014]);
    const inactiveAlpha =
      this.tracks.length > 4 ? GHOST_ALPHA * 0.38 : GHOST_ALPHA;

    for (const t of this.tracks) {
      const pts = t.points;
      if (pts.length < 2) continue;
      const active = this.activeId !== null && t.id === this.activeId;
      ctx.strokeStyle = ghostRgba(
        active ? GHOST_ALPHA * 2 : inactiveAlpha,
      );
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const c = latLonToClip(pts[i].lat, pts[i].lon);
        const [x, y] = this.px(c.x, c.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  dispose(): void {
    this.ov = null;
    this.tracks = [];
    this.activeId = null;
  }
}
