import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ResumeAnalyzer from './components/ResumeAnalyzer';
import JobSearch from './components/JobSearch';
import KanbanBoard from './components/KanbanBoard';
import Settings from './components/Settings';
import AgentPanel from './components/AgentPanel';
import { api } from './api/client';

// Hamburger icon (3 lines)
const IconMenu = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
  </svg>
);

// X close icon
const IconClose = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const PAGE_LABELS = {
  dashboard: 'Dashboard',
  analyzer: 'Resume Analyzer',
  jobs: 'Job Search',
  kanban: 'Job Tracker',
  agent: 'Job Agent',
  settings: 'Settings',
};

export default function App() {
  const [view, setView] = useState('dashboard');
  const [health, setHealth] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    // Check health of backend API immediately and poll every 10s
    const check = () => {
      api.health()
        .then(d => {
          setHealth(d.database === 'connected');
          if (d.keys_configured?.groq && !localStorage.getItem('groq_api_key')) {
            localStorage.setItem('groq_api_key', 'ENV_CONFIGURED');
          }
        })
        .catch(() => setHealth(false));
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  // Close sidebar when navigating on mobile
  const handleNav = (id) => {
    setView(id);
    setSidebarOpen(false);
  };

  const handleSaveJob = () => {
    setRefreshTick(prev => prev + 1);
  };

  return (
    <div className="app-shell">
      {/* Mobile backdrop */}
      <div
        className={`sidebar-backdrop${sidebarOpen ? ' open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <Sidebar active={view} setActive={handleNav} health={health} isOpen={sidebarOpen} />

      <main className="main-content">
        {/* Mobile top bar — only visible at < 768px */}
        <div className="mobile-topbar">
          <span className="mobile-topbar-title">{PAGE_LABELS[view]}</span>
          <button
            className="mobile-menu-btn"
            onClick={() => setSidebarOpen(o => !o)}
            aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <IconClose /> : <IconMenu />}
          </button>
        </div>

        {view === 'dashboard' && <Dashboard setView={handleNav} />}
        {view === 'analyzer' && <ResumeAnalyzer />}
        {view === 'jobs' && <JobSearch onSaveJob={handleSaveJob} />}
        {view === 'kanban' && <KanbanBoard refreshTick={refreshTick} />}
        {view === 'agent' && <AgentPanel onSaved={handleSaveJob} />}
        {view === 'settings' && <Settings />}
      </main>
    </div>
  );
}
