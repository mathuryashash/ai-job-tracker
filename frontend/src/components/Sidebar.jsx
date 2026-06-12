export default function Sidebar({ active, setActive, health }) {
  const nav = [
    { id: 'dashboard',  icon: '⚡', label: 'Dashboard'    },
    { id: 'analyzer',   icon: '📄', label: 'Resume Analyzer' },
    { id: 'jobs',       icon: '🔍', label: 'Job Search'    },
    { id: 'kanban',     icon: '📋', label: 'Job Tracker'   },
    { id: 'settings',   icon: '⚙️', label: 'Settings'      },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-text">AI Job Tracker</div>
        <div className="sidebar-logo-sub">Powered by Groq · Llama 70B</div>
      </div>

      <nav className="sidebar-nav">
        {nav.map(item => (
          <div
            key={item.id}
            className={`nav-item ${active === item.id ? 'active' : ''}`}
            onClick={() => setActive(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="flex items-center gap-8 text-xs text-muted">
          <span className={`status-dot ${health ? '' : 'bg-red'}`} style={!health ? { background: '#ef4444', boxShadow: '0 0 8px #ef4444' } : {}} />
          {health ? 'API Connected' : 'API Offline'}
        </div>
      </div>
    </aside>
  );
}
