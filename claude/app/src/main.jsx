import React from 'react';
import { createRoot } from 'react-dom/client';

// routes (hash based): "#/" = Studio (layout and look of the original app), "#/dev" = the first frontend (every parameter in a side panel)
const route = () => (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'studio');
const load = route() === 'dev' ? import('./DevApp.jsx') : import('./StudioApp.jsx');
window.addEventListener('hashchange', () => location.reload());
load.then((m) => createRoot(document.getElementById('root')).render(React.createElement(m.default)));
