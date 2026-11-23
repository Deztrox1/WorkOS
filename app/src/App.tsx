import { lazy, Suspense, useEffect, useLayoutEffect, type ComponentType, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Providers, Shell } from './components/Shell';
import { LoadGuard } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { startClock } from './lib/clock';
import { liveConfigMissing } from './lib/data';
import { ModeProvider, useMode } from './lib/mode';
import type { Mode } from './lib/types';
import { Reset, SignIn } from './screens/SignIn';
import { WarRoom } from './screens/WarRoom';

// The first screen loads with the app; every other screen loads when it is opened.
const later: (() => Promise<unknown>)[] = [() => import('./components/Capture')];
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => {
  later.push(load);
  return lazy(() => load().then((m) => ({ default: m[name] })));
};
const Campaigns = page(() => import('./screens/Campaigns'), 'Campaigns');
const Activity = page(() => import('./screens/Activity'), 'Activity');
const ClaudeScreen = page(() => import('./screens/Claude'), 'ClaudeScreen');
const Finance = page(() => import('./screens/Finance'), 'Finance');
const Habits = page(() => import('./screens/Habits'), 'Habits');
const More = page(() => import('./screens/More'), 'More');
const Notes = page(() => import('./screens/Notes'), 'Notes');
const Plan = page(() => import('./screens/Plan'), 'Plan');
const Reminders = page(() => import('./screens/Reminders'), 'Reminders');
const Settings = page(() => import('./screens/Settings'), 'Settings');
const Tasks = page(() => import('./screens/Tasks'), 'Tasks');

/** The service worker only keeps what passes through it, so fetch every screen once it is in charge: each one then opens offline. */
function keepScreensForOffline() {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  const run = () => { if (navigator.onLine) later.forEach((load) => void load().catch(() => undefined)); };
  const go = () => ('requestIdleCallback' in window ? window.requestIdleCallback(run) : setTimeout(run, 500));
  if (sw.controller) go();
  else sw.addEventListener('controllerchange', go, { once: true });
}

/** While a screen's file loads: the paper with its rows, not bare ground (R4U23). */
function PaperRows() {
  return <div className="sheetpaper page"><div className="state-rows"><div className="ph" /><div className="ph" /><div className="ph" /></div></div>;
}

function Gate({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const { pathname } = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/signin" replace />;
  return (
    <ModeProvider>
      <Providers>
        <Shell><LoadGuard key={pathname}><Suspense fallback={<PaperRows />}>{children}</Suspense></LoadGuard></Shell>
      </Providers>
    </ModeProvider>
  );
}

/** Campaigns and Finance are Work, Habits are Personal: opening one sets the mode, so nothing ever bounces (call N). */
function InArea({ area, children }: { area: Mode; children: ReactNode }) {
  const { mode, setMode } = useMode();
  useLayoutEffect(() => { if (mode !== area) setMode(area); }, [mode, area, setMode]);
  return mode === area ? <>{children}</> : null;
}

function Missing() {
  return (
    <main className="signin">
      <h1>WorkOS</h1>
      <p>The app has no Supabase key. Add VITE_SUPABASE_ANON_KEY to app/.env.local and rebuild, or run the dev build with VITE_DATA=mock to use sample data.</p>
    </main>
  );
}

export default function App() {
  useEffect(() => { startClock(); keepScreensForOffline(); }, []);
  if (liveConfigMissing()) return <Missing />;
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/" element={<Gate><WarRoom /></Gate>} />
          <Route path="/tasks" element={<Gate><Tasks /></Gate>} />
          <Route path="/plan" element={<Gate><Plan /></Gate>} />
          <Route path="/notes" element={<Gate><Notes /></Gate>} />
          <Route path="/more" element={<Gate><More /></Gate>} />
          <Route path="/reminders" element={<Gate><Reminders /></Gate>} />
          <Route path="/habits" element={<Gate><InArea area="personal"><Habits /></InArea></Gate>} />
          <Route path="/campaigns" element={<Gate><InArea area="work"><Campaigns /></InArea></Gate>} />
          <Route path="/finance" element={<Gate><InArea area="work"><Finance /></InArea></Gate>} />
          <Route path="/activity" element={<Gate><Activity /></Gate>} />
          <Route path="/feed" element={<Navigate to="/activity" replace />} />
          <Route path="/claude" element={<Gate><ClaudeScreen /></Gate>} />
          <Route path="/settings" element={<Gate><Settings /></Gate>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
