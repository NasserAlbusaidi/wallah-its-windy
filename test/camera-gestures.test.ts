import { describe, expect, it } from 'vitest';
import {
  CameraGestureController,
  PAN_THRESHOLD_PX,
  normalizeWheelDelta,
} from '../src/camera-gestures';
import {
  HOME_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  computeViewTransform,
  worldToNdc,
  ndcToWorld,
  viewStateOf,
} from '../src/camera';
import type { ViewState } from '../src/camera';

const ASPECT = 1.7;
const W = 1700;
const H = 1000;

function t(view: ViewState) {
  return computeViewTransform(view, ASPECT);
}

function controllerAt(view: ViewState = { center: { x: 0, y: 0 }, zoom: 3 }) {
  return new CameraGestureController(view);
}

function expectTransformClose(
  actual: ReturnType<typeof computeViewTransform>,
  expected: ReturnType<typeof computeViewTransform>,
): void {
  for (const key of ['scaleX', 'scaleY', 'offsetX', 'offsetY'] as const) {
    expect(actual[key]).toBeCloseTo(expected[key], 12);
  }
  for (const key of ['lonMin', 'lonMax', 'latMin', 'latMax'] as const) {
    expect(actual.bbox[key]).toBeCloseTo(expected.bbox[key], 10);
  }
}

describe('camera gesture controller', () => {
  it('normalizes wheel delta modes to bounded CSS pixels', () => {
    expect(normalizeWheelDelta(100, 0, H)).toBe(100);
    expect(normalizeWheelDelta(3, 1, H)).toBe(120);
    expect(normalizeWheelDelta(1, 2, H)).toBe(240);
    expect(normalizeWheelDelta(-1, 2, H)).toBe(-240);
    expect(normalizeWheelDelta(10_000, 0, H)).toBe(240);
    expect(normalizeWheelDelta(Number.NaN, 0, H)).toBe(0);
  });

  it('a sub-threshold move is not a pan and leaves the camera alone', () => {
    const c = controllerAt();
    const before = c.view();
    c.pointerDown(1, 100, 100);
    const u = c.pointerMove(t(before), 1, 100 + PAN_THRESHOLD_PX - 1, 100, W, H);
    expect(u.view).toBeNull();
    expect(u.becamePan).toBe(false);
    expect(c.pointerUp(1)).toBe(false); // clean tap: not suppressed
    expect(c.view()).toEqual(before);
  });

  it('crossing the threshold becomes a pan exactly once and suppresses the tap', () => {
    const c = controllerAt();
    const v0 = c.view();
    c.pointerDown(1, 200, 200);
    const first = c.pointerMove(t(v0), 1, 200 + PAN_THRESHOLD_PX + 4, 200, W, H);
    expect(first.becamePan).toBe(true);
    expect(first.view).not.toBeNull();
    //

    // Dragging the map east-to-west content-wise: pointer moved right, so the
    // camera centre moves WEST (content follows the finger).
    expect(first.view!.center.x).toBeLessThan(v0.center.x);
    const second = c.pointerMove(t(c.view()), 1, 260, 200, W, H);
    expect(second.becamePan).toBe(false); // only reported once
    expect(c.pointerUp(1)).toBe(true); // pan happened: suppress the tap
    // State machine resets for the next press.
    c.pointerDown(2, 10, 10);
    expect(c.pointerUp(2)).toBe(false);
  });

  it('wheel zooms about the cursor anchor', () => {
    const c = controllerAt();
    const t0 = t(c.view());
    const atX = 400;
    const atY = 300;
    const ndcX = (atX / W) * 2 - 1;
    const ndcY = 1 - (atY / H) * 2;
    const anchor = ndcToWorld(t0, ndcX, ndcY);
    const v1 = c.wheel(t0, -300, atX, atY, W, H); // negative deltaY = zoom in
    expect(v1.zoom).toBeGreaterThan(3);
    const after = worldToNdc(t(v1), anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(ndcX, 9);
    expect(after.y).toBeCloseTo(ndcY, 9);
  });

  it('pinch scales zoom by the finger-distance ratio and suppresses taps', () => {
    const c = controllerAt();
    c.pointerDown(1, 800, 500);
    c.pointerDown(2, 900, 500); // 100 px apart
    const u = c.pointerMove(t(c.view()), 2, 1000, 500, W, H); // 200 px apart
    expect(u.view).not.toBeNull();
    expect(u.view!.zoom).toBeCloseTo(6, 6); // 3 * (200/100)
    expect(c.pointerUp(2)).toBe(true);
    expect(c.pointerUp(1)).toBe(true);
  });

  it('moves the map with a translating pinch midpoint', () => {
    const c = controllerAt();
    c.pointerDown(1, 700, 500);
    c.pointerDown(2, 900, 500);
    const initialMidX = 800;
    const initialMidY = 500;
    const initialTransform = t(c.view());
    const anchor = ndcToWorld(
      initialTransform,
      (initialMidX / W) * 2 - 1,
      1 - (initialMidY / H) * 2,
    );

    const first = c.pointerMove(t(c.view()), 1, 720, 500, W, H);
    expect(first.view).not.toBeNull();
    const second = c.pointerMove(t(c.view()), 2, 920, 500, W, H);
    expect(second.view).not.toBeNull();

    const projected = worldToNdc(t(second.view!), anchor.x, anchor.y);
    expect(((projected.x + 1) / 2) * W).toBeCloseTo(initialMidX + 20, 6);
    expect(((1 - projected.y) / 2) * H).toBeCloseTo(initialMidY, 6);
    expect(second.view!.zoom).toBeCloseTo(3, 6);
  });

  it('zoom clamps to MAX_ZOOM and to the cover-fit floor', () => {
    const c = controllerAt({ center: { x: 0, y: 0 }, zoom: MAX_ZOOM });
    const v = c.wheel(t(c.view()), -10000, W / 2, H / 2, W, H);
    expect(v.zoom).toBe(MAX_ZOOM);
    const c2 = controllerAt({ center: { x: 0, y: 0 }, zoom: 1 });
    const v2 = c2.wheel(t(c2.view()), 10000, W / 2, H / 2, W, H);
    expect(v2.zoom).toBe(
      computeViewTransform(
        { center: { x: 0, y: 0 }, zoom: MIN_ZOOM },
        ASPECT,
      ).scaleY,
    );
  });

  it('does not pan when wheel or pinch asks to zoom below the aspect floor', () => {
    const wideW = 2000;
    const wideH = 1000;
    const homeTransform = computeViewTransform(HOME_VIEW, wideW / wideH);
    const clampedHome = viewStateOf(homeTransform);
    const wheel = new CameraGestureController(clampedHome);
    const wheelView = wheel.wheel(
      homeTransform,
      240,
      wideW * 0.82,
      wideH * 0.25,
      wideW,
      wideH,
    );
    expectTransformClose(
      computeViewTransform(wheelView, wideW / wideH),
      homeTransform,
    );

    const pinch = new CameraGestureController(clampedHome);
    pinch.pointerDown(1, 500, 500);
    pinch.pointerDown(2, 1500, 500);
    const first = pinch.pointerMove(
      homeTransform,
      1,
      600,
      500,
      wideW,
      wideH,
    );
    expect(first.view).not.toBeNull();
    const second = pinch.pointerMove(
      computeViewTransform(first.view!, wideW / wideH),
      2,
      1400,
      500,
      wideW,
      wideH,
    );
    expect(second.view).not.toBeNull();
    expectTransformClose(
      computeViewTransform(second.view!, wideW / wideH),
      homeTransform,
    );
  });

  it('keeps containment invariant when the aspect floor exceeds MAX_ZOOM', () => {
    const extremeW = 30_000;
    const extremeH = 1000;
    const transform = computeViewTransform(HOME_VIEW, extremeW / extremeH);
    expect(transform.scaleY).toBeGreaterThan(MAX_ZOOM);
    const c = new CameraGestureController(viewStateOf(transform));
    const out = c.key(transform, 'Minus', extremeW, extremeH);
    expect(out).not.toBeNull();
    expectTransformClose(
      computeViewTransform(out!, extremeW / extremeH),
      transform,
    );
  });

  it('keyboard pans, zooms, and homes', () => {
    const c = controllerAt();
    const v0 = c.view();
    const right = c.key(t(v0), 'ArrowRight', W, H);
    expect(right).not.toBeNull();
    expect(right!.center.x).toBeGreaterThan(v0.center.x);
    const up = c.key(t(c.view()), 'ArrowUp', W, H);
    expect(up!.center.y).toBeGreaterThan(right!.center.y);
    const zoomIn = c.key(t(c.view()), 'Equal', W, H);
    expect(zoomIn!.zoom).toBeGreaterThan(3);
    const home = c.key(t(c.view()), 'KeyH', W, H);
    expect(home).toEqual(HOME_VIEW);
    expect(c.key(t(c.view()), 'KeyQ', W, H)).toBeNull();
  });

  it('reset re-syncs the state (clamp feedback from the derived transform)', () => {
    const c = controllerAt();
    c.reset({ center: { x: 0.5, y: 0.5 }, zoom: 4 });
    expect(c.view().zoom).toBe(4);
    expect(c.view().center.x).toBeCloseTo(0.5, 12);
  });

  it('cancelAll invalidates an in-flight pan or pinch without changing the view', () => {
    const c = controllerAt();
    const before = c.view();
    c.pointerDown(1, 300, 300);
    c.pointerDown(2, 500, 300);

    c.cancelAll();

    expect(c.activePointers()).toBe(0);
    expect(c.pointerUp(1)).toBe(false);
    expect(c.pointerMove(t(c.view()), 2, 520, 300, W, H)).toEqual({
      view: null,
      becamePan: false,
    });
    expect(c.view()).toEqual(before);
  });
});
