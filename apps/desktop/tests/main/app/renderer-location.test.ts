import { describe, expect, it } from 'vitest';
import {
  DESKTOP_DEV_SERVER_URL,
  resolveDesktopRendererLocation,
} from '../../../src/main/renderer-location.js';

describe('Desktop Renderer location', () => {
  it('uses packaged files unless an unpackaged development URL is explicitly provided', () => {
    expect(resolveDesktopRendererLocation(true, DESKTOP_DEV_SERVER_URL)).toEqual({ kind: 'packaged-file' });
    expect(resolveDesktopRendererLocation(false, undefined)).toEqual({ kind: 'packaged-file' });
  });

  it('allows only an explicit loopback development origin', () => {
    expect(resolveDesktopRendererLocation(false, DESKTOP_DEV_SERVER_URL)).toEqual({
      kind: 'dev-server',
      url: DESKTOP_DEV_SERVER_URL,
      origin: DESKTOP_DEV_SERVER_URL,
    });
    expect(resolveDesktopRendererLocation(false, 'http://127.0.0.1:25173')).toEqual({
      kind: 'dev-server',
      url: 'http://127.0.0.1:25173',
      origin: 'http://127.0.0.1:25173',
    });
    expect(() => resolveDesktopRendererLocation(false, 'http://localhost:5173')).toThrow(/must be/);
    expect(() => resolveDesktopRendererLocation(false, 'https://example.test')).toThrow(/must be/);
  });
});
