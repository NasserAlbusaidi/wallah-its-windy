import { describe, expect, it } from 'vitest';
import { radarPresentation } from '../src/render';

describe('radar presentation boundary', () => {
  it('shows model products only when simulated radar is requested', () => {
    expect(radarPresentation('rain', 'simulated', false)).toEqual({
      observed: false,
      simulated: true,
    });
  });

  it('never substitutes model pixels while an observed frame is unavailable', () => {
    expect(radarPresentation('rain', 'observed', false)).toEqual({
      observed: false,
      simulated: false,
    });
  });

  it('shows a loaded observed frame without model pixels', () => {
    expect(radarPresentation('rain', 'observed', true)).toEqual({
      observed: true,
      simulated: false,
    });
  });

  it('keeps radar products out of every other weather layer', () => {
    expect(radarPresentation('terrain', 'simulated', true)).toEqual({
      observed: false,
      simulated: false,
    });
  });
});
