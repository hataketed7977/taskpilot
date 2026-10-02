export const DESKTOP_DEV_SERVER_URL = 'http://127.0.0.1:5173';

export type DesktopRendererLocation =
  | { kind: 'packaged-file' }
  | { kind: 'dev-server'; url: string; origin: string };

export function resolveDesktopRendererLocation(
  isPackaged: boolean,
  requestedUrl: string | undefined,
): DesktopRendererLocation {
  if (isPackaged || requestedUrl === undefined) return { kind: 'packaged-file' };
  if (requestedUrl !== DESKTOP_DEV_SERVER_URL) {
    throw new Error(`Desktop development server must be ${DESKTOP_DEV_SERVER_URL}.`);
  }
  return {
    kind: 'dev-server',
    url: requestedUrl,
    origin: new URL(requestedUrl).origin,
  };
}
