import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ResumeAnalyzer from './components/ResumeAnalyzer';
import JobSearch from './components/JobSearch';
import KanbanBoard from './components/KanbanBoard';
import Settings from './components/Settings';
import { api } from './api/client';

export default function App() {
  const [view, setView] = useState('dashboard');
  const [health, setHealth] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    // Check health of backend API immediately and poll every 10s
    const check = () => {
      api.health()
        .then(d => {
          setHealth(d.database === 'connected');
          // If we got keys from health response, propagate to local storage if local storage is empty
          if (d.keys_configured?.groq && !localStorage.getItem('groq_api_key')) {
            // Placeholder key to prevent UI blocker
            localStorage.setItem('groq_api_key', 'ENV_CONFIGURED');
          }
        })
        .catch(() => setHealth(false));
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveJob = () => {
    // Increment tick to force Kanban board to reload state
    setRefreshTick(prev => prev + 1);
  };

  return (
    <div className="app-shell">
      <Sidebar active={view} setActive={setView} health={health} />

      <main className="main-content">
        {view === 'dashboard' && <Dashboard setView={setView} />}
        {view === 'analyzer' && <ResumeAnalyzer />}
        {view === 'jobs' && <JobSearch onSaveJob={handleSaveJob} />}
        {view === 'kanban' && <KanbanBoard refreshTick={refreshTick} />}
        {view === 'settings' && <Settings />}
      </main>
    </div>
  );
}
