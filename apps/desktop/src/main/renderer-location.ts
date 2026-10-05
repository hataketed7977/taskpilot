export const DESKTOP_DEV_SERVER_URL = 'http://127.0.0.1:5173';

export type DesktopRendererLocation =
  | { kind: 'packaged-file' }
  | { kind: 'dev-server'; url: string; origin: string };

function isLoopbackDevelopmentOrigin(requestedUrl: string): boolean {
  try {
    const parsed = new URL(requestedUrl);
    const port = Number(parsed.port);
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && Number.isInteger(port)
      && port >= 1
      && port <= 65_535
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && parsed.origin === requestedUrl;
  } catch {
    return false;
  }
}

export function resolveDesktopRendererLocation(
  isPackaged: boolean,
  requestedUrl: string | undefined,
): DesktopRendererLocation {
  if (isPackaged || requestedUrl === undefined) return { kind: 'packaged-file' };
  if (!isLoopbackDevelopmentOrigin(requestedUrl)) {
    throw new Error('Desktop development server must be an explicit http://127.0.0.1:<port> origin.');
  }
  return {
    kind: 'dev-server',
    url: requestedUrl,
    origin: new URL(requestedUrl).origin,
  };
}
