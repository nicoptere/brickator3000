import React from 'react';
import { createRoot } from 'react-dom/client';
import StudioApp from './StudioApp.jsx';

// Clean up legacy hash routes (e.g. #/dev) and fallback to index.html / Studio
if (location.hash && location.hash.includes('dev')) {
  history.replaceState(null, '', location.pathname + location.search);
}

createRoot(document.getElementById('root')).render(React.createElement(StudioApp));
