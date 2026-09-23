import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './style.css';

// Explicitly enable EXT_float_blend on WebGL2 contexts for maximal portability & clean console
if (typeof HTMLCanvasElement !== 'undefined') {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function (contextId: string, ...args: any[]) {
    const ctx = (origGetContext as any).apply(this, [contextId, ...args]);
    if (ctx && (contextId === 'webgl2' || contextId === 'webgl' || contextId === 'experimental-webgl')) {
      const gl = ctx as any;
      try {
        gl.getExtension?.('EXT_float_blend');
        gl.getExtension?.('EXT_color_buffer_float');
        gl.getExtension?.('OES_texture_float');
      } catch (_) {}
    }
    return ctx;
  };
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}
