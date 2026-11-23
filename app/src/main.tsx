import '@fontsource/bricolage-grotesque/latin-600.css';
import '@fontsource/hanken-grotesk/latin-400.css';
import '@fontsource/hanken-grotesk/latin-500.css';
import '@fontsource/hanken-grotesk/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';
import './today.css';
import './shell.css';
import './warroom.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { captureRecovery } from './lib/auth';
import { prepareClient } from './lib/data';

// Read a password-recovery token from the hash before the router sees it (PRD 2 Routing).
captureRecovery();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

// The sample client can fail to load (offline after a deploy). The app still renders: getClient falls back to live (R4X10).
void prepareClient().catch(() => undefined).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
