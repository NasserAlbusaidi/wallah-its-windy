import { describe, expect, it } from 'vitest';
import {
  CameraGestureController,
  PAN_THRESHOLD_PX,
} from '../src/camera-gestures';
import {
  HOME_VIEW,
  MAX_ZOOM,
  computeViewTransform,
  worldToNdc,
  ndcToWorld,
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

describe('camera gesture controller', () => {
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

  it('zoom clamps to MAX_ZOOM and to the cover-fit floor', () => {
    const c = controllerAt({ center: { x: 0, y: 0 }, zoom: MAX_ZOOM });
    const v = c.wheel(t(c.view()), -10000, W / 2, H / 2, W, H);
    expect(v.zoom).toBe(MAX_ZOOM);
    const c2 = controllerAt({ center: { x: 0, y: 0 }, zoom: 1 });
    const v2 = c2.wheel(t(c2.view()), 10000, W / 2, H / 2, W, H);
    expect(v2.zoom).toBeGreaterThanOrEqual(1);
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
});
