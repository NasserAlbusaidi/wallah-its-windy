import { describe, expect, it } from 'vitest';
import {
  HOME_VIEW,
  MIN_ZOOM,
  MAX_ZOOM,
  computeViewTransform,
  latLonToScreen,
  ndcToWorld,
  panByPixels,
  screenToLatLon,
  viewKey,
  viewStateOf,
  worldToNdc,
  zoomAboutAnchor,
  type ViewState,
} from '../src/camera';
import { DISPLAY_CONTEXT_DOMAIN } from '../src/display-domain';

/** Canvas aspect at which Home shows the whole real context raster. */
const CONTEXT_METRIC_ASPECT =
  ((DISPLAY_CONTEXT_DOMAIN.lonMax - DISPLAY_CONTEXT_DOMAIN.lonMin) *
    Math.cos(
      (((DISPLAY_CONTEXT_DOMAIN.latMin + DISPLAY_CONTEXT_DOMAIN.latMax) / 2) *
        Math.PI) /
        180,
    )) /
  (DISPLAY_CONTEXT_DOMAIN.latMax - DISPLAY_CONTEXT_DOMAIN.latMin);

function metricAspectOf(bbox: {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}): number {
  const midLat = (bbox.latMin + bbox.latMax) / 2;
  return (
    ((bbox.lonMax - bbox.lonMin) * Math.cos((midLat * Math.PI) / 180)) /
    (bbox.latMax - bbox.latMin)
  );
}

function view(cx: number, cy: number, zoom: number): ViewState {
  return { center: { x: cx, y: cy }, zoom };
}

describe('camera view transform', () => {
  it('home view shows the complete real context at its metric aspect', () => {
    const t = computeViewTransform(HOME_VIEW, CONTEXT_METRIC_ASPECT);
    expect(t.scaleY).toBeCloseTo(MIN_ZOOM, 12);
    expect(t.bbox.lonMin).toBeCloseTo(DISPLAY_CONTEXT_DOMAIN.lonMin, 9);
    expect(t.bbox.lonMax).toBeCloseTo(DISPLAY_CONTEXT_DOMAIN.lonMax, 9);
    expect(t.bbox.latMin).toBeCloseTo(DISPLAY_CONTEXT_DOMAIN.latMin, 9);
    expect(t.bbox.latMax).toBeCloseTo(DISPLAY_CONTEXT_DOMAIN.latMax, 9);
  });

  it('cover-fit on a wide canvas crops context latitude without stretching', () => {
    const aspect = 2.0;
    const t = computeViewTransform(HOME_VIEW, aspect);
    expect(t.bbox.lonMin).toBeGreaterThanOrEqual(DISPLAY_CONTEXT_DOMAIN.lonMin - 1e-9);
    expect(t.bbox.lonMax).toBeLessThanOrEqual(DISPLAY_CONTEXT_DOMAIN.lonMax + 1e-9);
    expect(t.bbox.latMin).toBeGreaterThanOrEqual(DISPLAY_CONTEXT_DOMAIN.latMin - 1e-9);
    expect(t.bbox.latMax).toBeLessThanOrEqual(DISPLAY_CONTEXT_DOMAIN.latMax + 1e-9);
    // Width binds: full lon span, cropped lat span.
    expect(t.bbox.lonMax - t.bbox.lonMin).toBeCloseTo(35, 6);
    expect(t.bbox.latMax - t.bbox.latMin).toBeLessThan(22);
    // Unstretched: visible metric aspect matches the canvas aspect.
    expect(metricAspectOf(t.bbox) / aspect).toBeCloseTo(1, 2);
  });

  it('cover-fit on a squarer canvas shows full context latitude', () => {
    const aspect = 1.0;
    const t = computeViewTransform(HOME_VIEW, aspect);
    expect(t.bbox.latMax - t.bbox.latMin).toBeCloseTo(22, 6);
    expect(t.bbox.lonMax - t.bbox.lonMin).toBeLessThan(35);
    expect(metricAspectOf(t.bbox) / aspect).toBeCloseTo(1, 2);
  });

  it('world<->ndc round-trips exactly', () => {
    const t = computeViewTransform(view(0.3, -0.2, 3), 1.7);
    for (const [x, y] of [
      [0, 0],
      [0.31, -0.18],
      [-0.05, 0.12],
    ] as const) {
      const ndc = worldToNdc(t, x, y);
      const back = ndcToWorld(t, ndc.x, ndc.y);
      expect(back.x).toBeCloseTo(x, 12);
      expect(back.y).toBeCloseTo(y, 12);
    }
  });

  it('screen<->geo round-trips across zooms and centres', () => {
    const cases: Array<[ViewState, number]> = [
      [HOME_VIEW, CONTEXT_METRIC_ASPECT],
      [view(0, 0, 2.5), 1.9],
      [view(0.7, 0.6, 8), 1.3],
    ];
    const w = 1680;
    const h = 1000;
    for (const [v, aspect] of cases) {
      const t = computeViewTransform(v, aspect);
      for (const [xPx, yPx] of [
        [840, 500],
        [123, 47],
        [1600, 950],
      ] as const) {
        const p = screenToLatLon(t, xPx, yPx, w, h);
        const back = latLonToScreen(t, p.lat, p.lon, w, h);
        expect(back.x).toBeCloseTo(xPx, 9);
        expect(back.y).toBeCloseTo(yPx, 9);
      }
    }
  });

  it('clamps the centre so the view never leaves real display context', () => {
    const t = computeViewTransform(view(20, 20, 2), 1.6);
    expect(t.bbox.lonMax).toBeLessThanOrEqual(DISPLAY_CONTEXT_DOMAIN.lonMax + 1e-9);
    expect(t.bbox.latMax).toBeLessThanOrEqual(DISPLAY_CONTEXT_DOMAIN.latMax + 1e-9);
    expect(t.bbox.lonMin).toBeGreaterThanOrEqual(DISPLAY_CONTEXT_DOMAIN.lonMin - 1e-9);
    expect(t.bbox.latMin).toBeGreaterThanOrEqual(DISPLAY_CONTEXT_DOMAIN.latMin - 1e-9);
  });

  it('containment outranks MAX_ZOOM on hyper-wide canvases', () => {
    // Extreme aspect pushes the context cover-fit floor above MAX_ZOOM;
    // MAX_ZOOM, and the view must still stay inside the domain.
    const t = computeViewTransform(view(0, 0, 4), 30);
    expect(t.bbox.lonMin).toBeGreaterThanOrEqual(DISPLAY_CONTEXT_DOMAIN.lonMin - 1e-9);
    expect(t.bbox.lonMax).toBeLessThanOrEqual(DISPLAY_CONTEXT_DOMAIN.lonMax + 1e-9);
    expect(t.bbox.lonMax - t.bbox.lonMin).toBeCloseTo(35, 6);
  });

  it('clamps zoom to the cover-fit minimum and MAX_ZOOM', () => {
    const wide = computeViewTransform(view(0, 0, 0.2), 2.0);
    // Under-zoom clamps to cover-fit: canvas stays covered by context data.
    expect(wide.bbox.lonMax - wide.bbox.lonMin).toBeCloseTo(35, 6);
    const deep = computeViewTransform(view(0, 0, 50), 1.6);
    // Over-zoom clamps to MAX_ZOOM: view height = 12/MAX_ZOOM degrees.
    expect(deep.bbox.latMax - deep.bbox.latMin).toBeCloseTo(12 / MAX_ZOOM, 6);
  });

  it('zoomAboutAnchor keeps the anchor pinned on screen', () => {
    const aspect = 1.7;
    const w = 1700;
    const h = 1000;
    const v0 = view(0.1, -0.1, 2);
    const t0 = computeViewTransform(v0, aspect);
    const anchor = ndcToWorld(t0, 0.44, -0.3); // off-centre point
    const before = worldToNdc(t0, anchor.x, anchor.y);
    const v1 = zoomAboutAnchor(v0, anchor, 4);
    const t1 = computeViewTransform(v1, aspect);
    const after = worldToNdc(t1, anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect((((after.x + 1) / 2) * w - ((before.x + 1) / 2) * w)).toBeCloseTo(0, 6);
    expect((((1 - after.y) / 2) * h - ((1 - before.y) / 2) * h)).toBeCloseTo(0, 6);
  });

  it('panByPixels moves the centre by the pixel distance in world units', () => {
    const aspect = 1.7;
    const w = 1700;
    const h = 1000;
    const v0 = view(0, 0, 3);
    const t0 = computeViewTransform(v0, aspect);
    const v1 = panByPixels(v0, t0, 170, 0, w, h);
    const pxPerWorldX = (w * t0.scaleX) / 2;
    expect(v1.center.x - v0.center.x).toBeCloseTo(170 / pxPerWorldX, 12);
    expect(v1.center.y).toBeCloseTo(0, 12);
    // Panning far past the edge clamps once the transform is derived.
    const vFar = panByPixels(v0, t0, 1e7, 0, w, h);
    const tFar = computeViewTransform(vFar, aspect);
    expect(tFar.bbox.lonMax).toBeLessThanOrEqual(DISPLAY_CONTEXT_DOMAIN.lonMax + 1e-9);
  });

  it('viewStateOf recovers the clamped state a transform encodes', () => {
    const requested = view(20, 20, 2.5); // centre gets clamped
    const t = computeViewTransform(requested, 1.7);
    const clamped = viewStateOf(t);
    expect(clamped.zoom).toBeCloseTo(2.5, 12);
    // Re-deriving from the clamped state reproduces the same transform.
    const t2 = computeViewTransform(clamped, 1.7);
    expect(t2.scaleX).toBeCloseTo(t.scaleX, 9);
    expect(t2.offsetX).toBeCloseTo(t.offsetX, 9);
    expect(t2.offsetY).toBeCloseTo(t.offsetY, 9);
  });

  it('viewKey is stable for identical transforms and moves on any change', () => {
    const a = computeViewTransform(view(0.2, 0.1, 2), 1.7);
    const b = computeViewTransform(view(0.2, 0.1, 2), 1.7);
    const c = computeViewTransform(view(0.2, 0.1, 2.01), 1.7);
    expect(viewKey(a)).toBe(viewKey(b));
    expect(viewKey(a)).not.toBe(viewKey(c));
  });
});
