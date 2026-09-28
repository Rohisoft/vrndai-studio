import { Bot, Clapperboard, Film, History, Menu, Settings, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PasswordGate } from './components/PasswordGate.js';
import { useBackendStatus } from './hooks/useBackendStatus.js';
import { AssistantPage } from './pages/AssistantPage.js';
import { EditorPage } from './pages/EditorPage.js';
import { GalleryPage } from './pages/GalleryPage.js';
import { GeneratePage } from './pages/GeneratePage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

const STUDIO_LINKS = [
  { to: '/', icon: Sparkles, label: 'Create', end: true },
  { to: '/assistant', icon: Bot, label: 'Assistant', end: false },
];

const LIBRARY_LINKS = [
  { to: '/gallery', icon: Film, label: 'My Creations', end: false },
  { to: '/history', icon: History, label: 'History', end: false },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-neutral-700 text-white shadow-md shadow-black/30' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
  }`;

function NavGroup({ label, links, onNavigate }: { label: string; links: typeof STUDIO_LINKS; onNavigate: () => void }) {
  return (
    <div>
      <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">{label}</p>
      <div className="space-y-1">
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={navLinkClass} onClick={onNavigate}>
            <link.icon className="h-4 w-4" strokeWidth={2} />
            {link.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

// No VRAM readout here -- this app runs on RunPod Serverless, not a local
// GPU, so there's no real telemetry to show beyond connectivity + whether
// something's actively generating (see useBackendStatus's own comment).
function BackendStatusCard() {
  const { connected, generating } = useBackendStatus();

  const { dotClass, label } =
    connected === null
      ? { dotClass: 'bg-neutral-600', label: 'Checking…' }
      : connected === false
        ? { dotClass: 'bg-red-500', label: 'Disconnected' }
        : generating
          ? { dotClass: 'bg-violet-500', label: 'Generating' }
          : { dotClass: 'bg-emerald-500', label: 'Ready' };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 shadow-lg shadow-black/30">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-neutral-300">Backend</span>
        <span className="flex items-center gap-1.5 text-neutral-400">
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {label}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-neutral-600">RunPod Serverless</p>
    </div>
  );
}

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Below md, the sidebar is a slide-over rather than a static column -- close
  // it whenever the route actually changes (covers back/forward navigation
  // too, not just clicks handled by NavGroup's onNavigate).
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-dvh flex-col overflow-x-hidden bg-neutral-950 text-neutral-100 md:flex-row">
      <div className="flex flex-none items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4 py-3 shadow-md shadow-black/30 md:hidden">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Clapperboard className="h-4 w-4 text-violet-400" strokeWidth={2} />
          AI Video Studio
        </div>
        <button onClick={() => setSidebarOpen(true)} className="text-neutral-400 hover:text-neutral-200" aria-label="Open menu">
          <Menu className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>

      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-none flex-col border-r border-neutral-800 bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-950 shadow-[6px_0_30px_-8px_rgba(0,0,0,0.65)] transition-transform duration-200 md:relative md:z-auto md:w-56 md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Thin glowing edge on top of the solid border -- gives the sidebar
            a distinct "panel" feel instead of blending into the page. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-violet-500/50 to-transparent" />

        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Clapperboard className="h-4 w-4 text-violet-400" strokeWidth={2} />
            AI Video Studio
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-neutral-500 hover:text-neutral-300 md:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <nav className="flex-1 space-y-4 px-3">
          <NavGroup label="Studio" links={STUDIO_LINKS} onNavigate={() => setSidebarOpen(false)} />
          <NavGroup label="Library" links={LIBRARY_LINKS} onNavigate={() => setSidebarOpen(false)} />
        </nav>
        <div className="space-y-2 px-3 pb-3">
          <BackendStatusCard />
          <NavLink to="/settings" end={false} className={navLinkClass} onClick={() => setSidebarOpen(false)}>
            <Settings className="h-4 w-4" strokeWidth={2} />
            Settings
          </NavLink>
        </div>
      </aside>

      <main
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
        style={{ backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(76,29,149,0.12), transparent 45%)' }}
      >
        <Routes>
          <Route path="/" element={<GeneratePage />} />
          <Route path="/jobs/:id" element={<GeneratePage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <PasswordGate>
      <AppShell />
    </PasswordGate>
  );
}
