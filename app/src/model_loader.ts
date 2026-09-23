/**
 * Resilient ONNX model downloader with:
 * 1. Persistent browser CacheStorage caching across sessions & page refreshes.
 * 2. Automatic retry with exponential backoff on network dropouts.
 * 3. Exact byte-level streaming verification to prevent truncated body errors.
 */

export async function evictModelCache(url: string): Promise<void> {
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const keys = await window.caches.keys();
      for (const k of keys) {
        if (k.startsWith('bricknet-models-cache-')) {
          const c = await window.caches.open(k);
          await c.delete(url);
        }
      }
      console.log(`[ModelLoader] Evicted ${url} from all browser caches.`);
    } catch (e) {
      console.warn('[ModelLoader] Failed to evict model from cache:', e);
    }
  }
}

export async function loadModelBuffer(
  url: string,
  onProgress?: (status: string) => void,
  maxRetries = 3
): Promise<ArrayBuffer> {
  const cacheName = 'bricknet-models-cache-v4';
  let cache: Cache | null = null;

  // 1. Try CacheStorage & purge obsolete versions
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const keys = await window.caches.keys();
      for (const k of keys) {
        if (k.startsWith('bricknet-models-cache-') && k !== cacheName) {
          console.log(`[ModelLoader] Purging obsolete model cache: ${k}`);
          await window.caches.delete(k);
        }
      }
      cache = await window.caches.open(cacheName);
      const cached = await cache.match(url);
      if (cached && cached.ok) {
        const buffer = await cached.arrayBuffer();
        if (buffer && buffer.byteLength > 1024) {
          console.log(`✓ Loaded model from persistent browser cache (${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB): ${url}`);
          return buffer;
        }
      }
    } catch (e) {
      console.warn('[ModelLoader] Cache check failed, falling back to network:', e);
    }
  }

  // 2. Fetch over network with retry
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = attempt * 1200;
        if (onProgress) onProgress(`Retrying model download (attempt ${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
      }

      if (onProgress) onProgress(`Downloading model weights (${attempt}/${maxRetries})...`);

      const response = await fetch(url, {
        cache: 'no-store', // Avoid partial stale browser disk cache
        headers: {
          'Accept': '*/*'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      const expectedBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

      let buffer: ArrayBuffer;

      // Use ReadableStream if available for byte verification and progress tracking
      if (response.body && typeof ReadableStream !== 'undefined') {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.length;
            if (expectedBytes > 0 && onProgress) {
              const pct = Math.min(99, Math.round((receivedBytes / expectedBytes) * 100));
              const mbReceived = (receivedBytes / (1024 * 1024)).toFixed(1);
              const mbTotal = (expectedBytes / (1024 * 1024)).toFixed(1);
              onProgress(`Downloading weights: ${pct}% (${mbReceived} / ${mbTotal} MB)`);
            }
          }
        }

        if (expectedBytes > 0 && receivedBytes < expectedBytes) {
          throw new Error(`Incomplete body received: ${receivedBytes} of ${expectedBytes} bytes.`);
        }

        const fullArray = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          fullArray.set(chunk, offset);
          offset += chunk.length;
        }
        buffer = fullArray.buffer;
      } else {
        buffer = await response.arrayBuffer();
        if (expectedBytes > 0 && buffer.byteLength < expectedBytes) {
          throw new Error(`Incomplete body: got ${buffer.byteLength} of ${expectedBytes} bytes.`);
        }
      }

      // Save valid buffer in CacheStorage for future visits
      if (cache && buffer.byteLength > 1024) {
        try {
          const cacheResponse = new Response(buffer, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Length': buffer.byteLength.toString()
            }
          });
          await cache.put(url, cacheResponse);
          console.log(`✓ Cached model in browser storage: ${url}`);
        } catch (cErr) {
          console.warn('[ModelLoader] Failed to save to CacheStorage:', cErr);
        }
      }

      return buffer;
    } catch (err: any) {
      console.warn(`[ModelLoader] Download attempt ${attempt} failed:`, err);
      lastErr = err;
    }
  }

  throw lastErr || new Error(`Failed to download ${url} after ${maxRetries} attempts.`);
}
