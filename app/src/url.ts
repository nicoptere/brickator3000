/**
 * Utility to resolve relative asset URLs regardless of whether the app is hosted
 * at domain root ('/'), a subfolder ('/lego/'), or with/without a trailing slash.
 */

export function getAssetUrl(relPath: string): string {
  const cleanPath = relPath.replace(/^\/+/, '');

  if (typeof window !== 'undefined' && window.location) {
    let pathname = window.location.pathname;
    // If the path ends with an extension (e.g. /lego/index.html), take directory
    if (pathname.split('/').pop()?.includes('.')) {
      pathname = pathname.substring(0, pathname.lastIndexOf('/') + 1);
    } else if (!pathname.endsWith('/')) {
      pathname += '/';
    }
    return `${window.location.origin}${pathname}${cleanPath}`;
  }

  // Fallback for SSR or non-browser contexts
  const baseUrl = (import.meta as any).env?.BASE_URL || './';
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${cleanPath}`;
}
