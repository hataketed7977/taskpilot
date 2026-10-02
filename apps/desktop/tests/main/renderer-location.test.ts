import { describe, expect, it } from 'vitest';
import {
  DESKTOP_DEV_SERVER_URL,
  resolveDesktopRendererLocation,
} from '../../src/main/renderer-location.js';

describe('Desktop Renderer location', () => {
  it('uses packaged files unless an unpackaged development URL is explicitly provided', () => {
    expect(resolveDesktopRendererLocation(true, DESKTOP_DEV_SERVER_URL)).toEqual({ kind: 'packaged-file' });
    expect(resolveDesktopRendererLocation(false, undefined)).toEqual({ kind: 'packaged-file' });
  });

  it('allows only the fixed loopback development origin', () => {
    expect(resolveDesktopRendererLocation(false, DESKTOP_DEV_SERVER_URL)).toEqual({
      kind: 'dev-server',
      url: DESKTOP_DEV_SERVER_URL,
      origin: DESKTOP_DEV_SERVER_URL,
    });
    expect(() => resolveDesktopRendererLocation(false, 'http://localhost:5173')).toThrow(/must be/);
    expect(() => resolveDesktopRendererLocation(false, 'https://example.test')).toThrow(/must be/);
  });
});
