// Unified model source discovery and loader for Brickagen Studio
// Supports local dev server (/api/models, /models/), static GCS hosting (./models/models.json),
// and CDN fallback to the existing 2026 LEGO models library.

export async function fetchModelList() {
  const urls = [
    new URL('./models/models.json', location.href).href,
    new URL('./models.json', location.href).href,
    '/api/models'
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (res.ok) {
        const d = await res.json();
        if (d && Array.isArray(d.models) && d.models.length > 0) {
          return d.models;
        }
      }
    } catch {}
  }
  return [];
}

export async function fetchModelBuffer(p) {
  const cleanPath = p.replace(/^\.?\/?models\//, '');
  const pathVariants = [cleanPath];
  if (cleanPath.includes('/taschen/')) {
    pathVariants.push(cleanPath.replace('/taschen/', '/'));
  } else if (cleanPath.startsWith('clean/') && !cleanPath.startsWith('clean/taschen/')) {
    pathVariants.push(cleanPath.replace(/^clean\//, 'clean/taschen/'));
  }

  const urls = [];
  for (const v of pathVariants) {
    urls.push(new URL('./models/' + v, location.href).href);
    urls.push(`https://storage.googleapis.com/nicoptere/2026/lego/generator/models/${v}`);
    urls.push(`https://storage.googleapis.com/nicoptere/2026/lego/brickagen/models/${v}`);
    urls.push('/models/' + v);
  }

  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.arrayBuffer();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Failed to load model "${p}": ${lastErr ? lastErr.message : 'Not found'}`);
}
