import { defineConfig, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function createLDrawMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url) return next();

    // Intercept /ldraw/ requests with smart fallback resolution across parts/p/s/models
    if (req.url.startsWith('/ldraw/')) {
      const rawUrl = decodeURIComponent(req.url.split('?')[0]);
      const ldrawBase = path.join(__dirname, 'public', 'ldraw');
      const fallbackBase = path.resolve(__dirname, '../app/public/ldraw');

      // Strip leading /ldraw/ and normalize any Windows backslashes
      let sub = rawUrl.replace(/^\/ldraw\//, '').replace(/\\/g, '/');
      sub = sub.replace(/^(parts\/)+/i, 'parts/');
      sub = sub.replace(/^(p\/)+/i, 'p/');
      sub = sub.replace(/^(p|models|parts)\/parts\//i, 'parts/');

      const fname = path.basename(sub);
      const bases = [ldrawBase];
      if (fs.existsSync(fallbackBase)) bases.push(fallbackBase);
      const masterLDraw = '/mnt/storage/lego/ldraw';
      if (fs.existsSync(masterLDraw)) bases.push(masterLDraw);

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
  };
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'serve-ldraw-smart-fallback',
      configureServer(server) {
        server.middlewares.use(createLDrawMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createLDrawMiddleware());
      }
    }
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'three'],
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      three: path.resolve(__dirname, 'node_modules/three')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5175,
    watch: {
      ignored: ['**/public/ldraw/**', '**/public/models/**', '**/dist/**']
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
    port: 5174,
    headers: {
      'Cross-Origin-Resource-Policy': 'cross-origin'
    }
  },
  build: {
    target: 'esnext'
  }
});
