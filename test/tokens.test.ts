import { describe, expect, it } from 'vitest';
import { PANEL_GLASS, TOKENS, injectCssVars } from '../src/tokens';

describe('windy-grade chrome tokens', () => {
  it('defines the chrome palette additions', () => {
    expect(TOKENS.uiAccent.css).toBe('#59d8e6');
    expect(TOKENS.panelEdge.cssVar).toBe('--panel-edge');
    expect(TOKENS.textHi.css).toBe('#e8f1f8');
    expect(TOKENS.textMut.css).toBe('#8fa3b8');
    expect(TOKENS.textDim.css).toBe('#6d8296');
    expect(PANEL_GLASS).toBe('rgba(11,16,26,0.82)');
  });

  it('injects the new radii and vars onto a target element', () => {
    const properties = new Map<string, string>();
    const el = {
      style: {
        setProperty(name: string, value: string): void {
          properties.set(name, value);
        },
        getPropertyValue(name: string): string {
          return properties.get(name) ?? '';
        },
      },
    } as unknown as HTMLElement;
    injectCssVars(el);
    expect(el.style.getPropertyValue('--ui-accent')).toBe('#59d8e6');
    expect(el.style.getPropertyValue('--radius-panel')).toBe('10px');
    expect(el.style.getPropertyValue('--radius-ctl')).toBe('7px');
  });
});
