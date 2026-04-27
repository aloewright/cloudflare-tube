import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Lazy-load RUM so it never blocks first paint — web-vitals registers its
// observers internally with passive listeners. Errors here must never break
// the app render.
void import('./lib/rum')
  .then(({ startRum }) => startRum())
  .catch(() => undefined);
