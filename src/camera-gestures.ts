/**
 * camera-gestures.ts — the pointer/wheel/keyboard state machine for the map
 * camera (UX v2 phase 2).
 *
 * A pure controller in the intensity-sparkline pattern: no DOM, no sim, no
 * clock — main.ts feeds it canvas-relative CSS-pixel events plus the current
 * derived ViewTransform, and it returns new ViewState values built from the
 * camera.ts helpers. Arbitration contract with the existing tap-to-spawn and
 * touch-probe gestures: a single pointer becomes a PAN exactly once, when it
 * moves past {@link PAN_THRESHOLD_PX} (the same 10-px neighbourhood the tap
 * and probe timers already use to reject drags); a second pointer makes the
 * pair a PINCH immediately. `pointerUp` reports whether ANY pan/pinch
 * happened since the pointer went down so the caller can suppress the tap.
 */

import {
  computeViewTransform,
  HOME_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  ndcToWorld,
  panByPixels,
  zoomAboutAnchor,
} from './camera';
import type { ViewState, ViewTransform } from './types';

/** One-pointer drag distance (CSS px) at which the gesture becomes a pan. */
export const PAN_THRESHOLD_PX = 8;
/** exp(-deltaY * rate): ~x1.16 per 100 CSS-pixel wheel step. */
const WHEEL_ZOOM_RATE = 0.0015;
/** A conventional browser wheel line is roughly one legacy 40 px step. */
const WHEEL_LINE_PX = 40;
/** Prevent one page-mode or device-spike event from jumping several zoom levels. */
const MAX_WHEEL_DELTA_PX = 240;
const KEY_PAN_PX = 64;
const KEY_ZOOM_FACTOR = 1.25;

interface TrackedPointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export interface GestureUpdate {
  /** New camera state when the move changed it, else null. */
  view: ViewState | null;
  /** True exactly once, on the move that crossed the pan threshold. */
  becamePan: boolean;
}

function clampZoom(zoom: number, minimum = MIN_ZOOM): number {
  // Extreme aspect ratios can require a cover-fit floor above MAX_ZOOM; in
  // that case containment wins, matching camera.ts clampPass.
  const floor = Math.max(MIN_ZOOM, minimum);
  return Math.min(Math.max(MAX_ZOOM, floor), Math.max(floor, zoom));
}

function coverFitFloor(view: ViewState, w: number, h: number): number {
  return computeViewTransform(
    { center: view.center, zoom: MIN_ZOOM },
    Math.max(1, w) / Math.max(1, h),
  ).scaleY;
}

/**
 * Convert WheelEvent delta units to bounded CSS pixels before applying the
 * exponential zoom curve. Numeric modes mirror DOM_DELTA_PIXEL/LINE/PAGE so
 * this helper remains testable without a browser DOM.
 */
export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  pageHeightPx: number,
): number {
  if (!Number.isFinite(deltaY)) return 0;
  const unit =
    deltaMode === 1
      ? WHEEL_LINE_PX
      : deltaMode === 2
        ? Math.max(1, Number.isFinite(pageHeightPx) ? pageHeightPx : 1)
        : 1;
  return Math.max(
    -MAX_WHEEL_DELTA_PX,
    Math.min(MAX_WHEEL_DELTA_PX, deltaY * unit),
  );
}

export class CameraGestureController {
  private pointers = new Map<number, TrackedPointer>();
  private panning = false;
  private pinching = false;
  /** Any pan/pinch since the first pointer of this press went down. */
  private gestured = false;

  constructor(private current: ViewState = HOME_VIEW) {}

  view(): ViewState {
    return this.current;
  }

  /** Pointers currently down (2+ = pinch in progress). */
  activePointers(): number {
    return this.pointers.size;
  }

  /** Re-sync state (e.g. from the clamped transform main derived). */
  reset(view: ViewState): void {
    this.current = view;
  }

  /** Wheel/trackpad zoom about the cursor. Returns the new state. */
  wheel(
    t: ViewTransform,
    deltaY: number,
    atX: number,
    atY: number,
    w: number,
    h: number,
  ): ViewState {
    const ndcX = (atX / w) * 2 - 1;
    const ndcY = 1 - (atY / h) * 2;
    const anchor = ndcToWorld(t, ndcX, ndcY);
    const zoom = clampZoom(
      this.current.zoom * Math.exp(-deltaY * WHEEL_ZOOM_RATE),
      coverFitFloor(this.current, w, h),
    );
    this.current = zoomAboutAnchor(this.current, anchor, zoom);
    return this.current;
  }

  pointerDown(id: number, x: number, y: number): void {
    this.pointers.set(id, { x, y, startX: x, startY: y });
    if (this.pointers.size === 1) {
      this.panning = false;
      this.gestured = false;
    } else if (this.pointers.size === 2) {
      this.pinching = true;
      this.gestured = true;
    }
  }

  pointerMove(
    t: ViewTransform,
    id: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): GestureUpdate {
    const p = this.pointers.get(id);
    if (!p) return { view: null, becamePan: false };
    const prevX = p.x;
    const prevY = p.y;
    p.x = x;
    p.y = y;

    if (this.pinching && this.pointers.size >= 2) {
      const values = [...this.pointers.values()];
      const other = values.find((candidate) => candidate !== p);
      if (!other) return { view: null, becamePan: false };
      const prevDist = Math.hypot(prevX - other.x, prevY - other.y);
      const dist = Math.hypot(x - other.x, y - other.y);
      if (prevDist < 1e-3 || dist < 1e-3) return { view: null, becamePan: false };
      const prevMidX = (prevX + other.x) / 2;
      const prevMidY = (prevY + other.y) / 2;
      const midX = (x + other.x) / 2;
      const midY = (y + other.y) / 2;
      // The world point under the OLD midpoint follows the gesture to the NEW
      // midpoint. Anchoring at the new midpoint (the old implementation) kept
      // scale changes but discarded two-finger translation, making a drifting
      // pinch jump and slide away from the fingers.
      const anchor = ndcToWorld(
        t,
        (prevMidX / w) * 2 - 1,
        1 - (prevMidY / h) * 2,
      );
      const zoom = clampZoom(
        this.current.zoom * (dist / prevDist),
        coverFitFloor(this.current, w, h),
      );
      const zoomed = zoomAboutAnchor(this.current, anchor, zoom);
      const zoomedTransform = computeViewTransform(zoomed, w / h);
      this.current = panByPixels(
        zoomed,
        zoomedTransform,
        -(midX - prevMidX),
        -(midY - prevMidY),
        w,
        h,
      );
      return { view: this.current, becamePan: false };
    }

    if (this.pointers.size === 1) {
      const fromStart = Math.hypot(x - p.startX, y - p.startY);
      const becamePan = !this.panning && fromStart > PAN_THRESHOLD_PX;
      if (becamePan) {
        this.panning = true;
        this.gestured = true;
      }
      if (this.panning) {
        // Content follows the finger: pointer +dx means the camera moves west.
        this.current = panByPixels(
          this.current,
          t,
          -(x - prevX),
          -(y - prevY),
          w,
          h,
        );
        return { view: this.current, becamePan };
      }
    }
    return { view: null, becamePan: false };
  }

  /** Returns true when a pan/pinch happened — the caller suppresses the tap. */
  pointerUp(id: number): boolean {
    this.pointers.delete(id);
    const was = this.gestured;
    if (this.pointers.size === 0) {
      this.panning = false;
      this.pinching = false;
      this.gestured = false;
    } else if (this.pointers.size < 2) {
      this.pinching = false;
    }
    return was;
  }

  pointerCancel(id: number): void {
    this.pointerUp(id);
  }

  /** Invalidate every in-flight contact when the map geometry changes. */
  cancelAll(): void {
    this.pointers.clear();
    this.panning = false;
    this.pinching = false;
    this.gestured = false;
  }

  /**
   * Keyboard controls (event.code): arrows pan, Equal/Minus (+numpad) zoom
   * about the view centre, KeyH/Home return to the full-domain view.
   * Returns the new state, or null when the key is not a camera key.
   */
  key(
    t: ViewTransform,
    code: string,
    w: number,
    h: number,
  ): ViewState | null {
    switch (code) {
      case 'ArrowLeft':
        this.current = panByPixels(this.current, t, -KEY_PAN_PX, 0, w, h);
        return this.current;
      case 'ArrowRight':
        this.current = panByPixels(this.current, t, KEY_PAN_PX, 0, w, h);
        return this.current;
      case 'ArrowUp':
        this.current = panByPixels(this.current, t, 0, -KEY_PAN_PX, w, h);
        return this.current;
      case 'ArrowDown':
        this.current = panByPixels(this.current, t, 0, KEY_PAN_PX, w, h);
        return this.current;
      case 'Equal':
      case 'NumpadAdd':
        this.current = zoomAboutAnchor(
          this.current,
          this.current.center,
          clampZoom(
            this.current.zoom * KEY_ZOOM_FACTOR,
            coverFitFloor(this.current, w, h),
          ),
        );
        return this.current;
      case 'Minus':
      case 'NumpadSubtract':
        this.current = zoomAboutAnchor(
          this.current,
          this.current.center,
          clampZoom(
            this.current.zoom / KEY_ZOOM_FACTOR,
            coverFitFloor(this.current, w, h),
          ),
        );
        return this.current;
      case 'KeyH':
      case 'Home':
        this.current = HOME_VIEW;
        return this.current;
      default:
        return null;
    }
  }
}
