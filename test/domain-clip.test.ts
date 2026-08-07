import { describe, expect, it } from 'vitest';
import { HOME_VIEW, computeViewTransform } from '../src/camera';
import { DISPLAY_CONTEXT_DOMAIN } from '../src/display-domain';
import { latLonToClip } from '../src/grid';
import { domainCanvasRect, domainScissorRect } from '../src/domain-clip';

const CONTEXT_ASPECT =
  ((DISPLAY_CONTEXT_DOMAIN.lonMax - DISPLAY_CONTEXT_DOMAIN.lonMin) *
    Math.cos(
      (((DISPLAY_CONTEXT_DOMAIN.latMin + DISPLAY_CONTEXT_DOMAIN.latMax) / 2) *
        Math.PI) /
        180,
    )) /
  (DISPLAY_CONTEXT_DOMAIN.latMax - DISPLAY_CONTEXT_DOMAIN.latMin);

describe('simulation-domain screen clip', () => {
  it('clips weather to an inner rectangle in the regional Home view', () => {
    const width = 1504;
    const height = 1000;
    const rect = domainScissorRect(
      computeViewTransform(HOME_VIEW, CONTEXT_ASPECT),
      width,
      height,
    );
    expect(rect.x).toBeGreaterThan(0);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.x + rect.width).toBeLessThan(width);
    expect(rect.y + rect.height).toBeLessThan(height);
    expect(rect.width / width).toBeCloseTo(20 / 35, 2);
    expect(rect.height / height).toBeCloseTo(12 / 22, 2);
    const canvasRect = domainCanvasRect(
      computeViewTransform(HOME_VIEW, CONTEXT_ASPECT),
      width,
      height,
    );
    expect(canvasRect).toEqual({
      x: rect.x,
      y: height - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    });
  });

  it('fills the viewport when every simulation edge is off-screen', () => {
    const width = 1600;
    const height = 1000;
    const view = computeViewTransform(
      { center: latLonToClip(21, 60), zoom: 4 },
      width / height,
    );
    expect(domainScissorRect(view, width, height)).toEqual({
      x: 0,
      y: 0,
      width,
      height,
    });
  });

  it('returns an empty rect when the simulation box is outside the view', () => {
    const width = 1200;
    const height = 800;
    const westIndia = computeViewTransform(
      { center: latLonToClip(20, 77), zoom: 5 },
      width / height,
    );
    expect(domainScissorRect(westIndia, width, height).width).toBe(0);
  });
});
