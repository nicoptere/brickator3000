import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    basicSsl(),
    react(),
    {
      name: 'serve-wasm-and-ldraw',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url) return next();

          // Intercept /models/ requests to prevent stale model caching
          if (req.url.startsWith('/models/')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }

          // Intercept /ldraw/ requests with smart fallback resolution across parts/p/s/models
          if (req.url.startsWith('/ldraw/')) {
            const rawUrl = decodeURIComponent(req.url.split('?')[0]);
            const ldrawBase = path.join(__dirname, 'public', 'ldraw');
            const devFallbackBase = path.resolve(__dirname, '../../ldraw');

            // Strip leading /ldraw/ and normalize any Windows backslashes
            let sub = rawUrl.replace(/^\/ldraw\//, '').replace(/\\/g, '/');
            // Clean duplicate prefixes e.g. parts/parts/s/... or p/parts/s/... or models/parts/s/...
            sub = sub.replace(/^(parts\/)+/i, 'parts/');
            sub = sub.replace(/^(p\/)+/i, 'p/');
            sub = sub.replace(/^(p|models|parts)\/parts\//i, 'parts/');

            const fname = path.basename(sub);
            const bases = [ldrawBase];
            if (fs.existsSync(devFallbackBase)) bases.push(devFallbackBase);

            const candidates: string[] = [];
            for (const b of bases) {
              candidates.push(
                path.join(b, sub),
                path.join(b, sub.toLowerCase()),
                path.join(b, 'parts', sub),
                path.join(b, 'parts', sub.toLowerCase()),
                path.join(b, 'p', fname),
                path.join(b, 'p', fname.toLowerCase()),
                path.join(b, 'p', '48', fname),
                path.join(b, 'p', '48', fname.toLowerCase()),
                path.join(b, 'p', '8', fname),
                path.join(b, 'p', '8', fname.toLowerCase()),
                path.join(b, 'parts', 's', fname),
                path.join(b, 'parts', 's', fname.toLowerCase()),
                path.join(b, 'parts', fname),
                path.join(b, 'parts', fname.toLowerCase()),
                path.join(b, 'models', fname)
              );
            }

            let resolvedFile: string | null = null;
            for (const c of candidates) {
              try {
                if (fs.existsSync(c) && fs.statSync(c).isFile()) {
                  resolvedFile = c;
                  break;
                }
              } catch (_) {}
            }

            if (resolvedFile) {
              res.setHeader('Content-Type', 'text/plain');
              res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
              res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
              res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
              return fs.createReadStream(resolvedFile).pipe(res);
            } else {
              res.statusCode = 404;
              return res.end('404 Not Found');
            }
          }

          next();
        });
      }
    }
  ],
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: true,
    watch: {
      ignored: ['**/public/ldraw/**', '**/dist/**']
    },
    headers: {
      'Cross-Origin-Resource-Policy': 'cross-origin'
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    https: true,
    headers: {
      'Cross-Origin-Resource-Policy': 'cross-origin'
    }
  },
  build: {
    target: 'esnext'
  }
});
