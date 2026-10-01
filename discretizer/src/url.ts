/**
 * Asset URL helper to handle dev/preview/production relative base paths.
 */
export function getAssetUrl(relPath: string): string {
  const cleanPath = relPath.replace(/^\/+/, '');

  if (typeof window !== 'undefined' && window.location) {
    let pathname = window.location.pathname;
    if (pathname.split('/').pop()?.includes('.')) {
      pathname = pathname.substring(0, pathname.lastIndexOf('/') + 1);
    } else if (!pathname.endsWith('/')) {
      pathname += '/';
    }
    return `${window.location.origin}${pathname}${cleanPath}`;
  }

  const baseUrl = (import.meta as any).env?.BASE_URL || './';
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${cleanPath}`;
}
