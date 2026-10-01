/**
 * Asset URL helper to handle dev/preview/production relative base paths.
 * Supports hosting at domain root ('/'), subpaths ('/2026/lego/generator/'), or with 'index.html'.
 */
export function getAssetUrl(relPath: string): string {
  if (!relPath) return relPath;
  if (relPath.startsWith('http://') || relPath.startsWith('https://') || relPath.startsWith('blob:') || relPath.startsWith('data:')) {
    return relPath;
  }

  const cleanPath = relPath.replace(/^\/+/, '');

  if (typeof window !== 'undefined' && window.location) {
    let pathname = window.location.pathname;
    // If the path ends with an extension (e.g. /generator/index.html), take directory
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
