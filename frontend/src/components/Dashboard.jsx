import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function Dashboard({ setView }) {
  const [apps, setApps]     = useState([]);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.getApplications()
      .then(d => setApps(d.data || []))
      .catch(() => {});
    api.health()
      .then(setHealth)
      .catch(() => {});
  }, []);

  const stats = {
    total:        apps.length,
    todo:         apps.filter(a => a.status === 'todo').length,
    applied:      apps.filter(a => a.status === 'applied').length,
    interviewing: apps.filter(a => a.status === 'interviewing').length,
    offer:        apps.filter(a => a.status === 'offer').length,
    rejected:     apps.filter(a => a.status === 'rejected').length,
  };

  const recentApps = [...apps]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 5);

  const STATUS_COLOR = { todo: '#6366f1', applied: '#3b82f6', interviewing: '#f59e0b', offer: '#10b981', rejected: '#ef4444' };

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">⚡ Dashboard</div>
          <div className="page-subtitle">Your job search at a glance</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setView('analyzer')}>📄 New Analysis</button>
          <button className="btn btn-secondary" onClick={() => setView('jobs')}>🔍 Search Jobs</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid-4 mb-24">
        <div className="card" style={{ borderTop: '3px solid #6366f1' }}>
          <div className="card-title">Total Applications</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">across all stages</div>
        </div>
        <div className="card" style={{ borderTop: '3px solid #f59e0b' }}>
          <div className="card-title">Interviewing</div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>{stats.interviewing}</div>
          <div className="stat-label">active conversations</div>
        </div>
        <div className="card" style={{ borderTop: '3px solid #10b981' }}>
          <div className="card-title">Offers</div>
          <div className="stat-value" style={{ color: '#10b981' }}>{stats.offer}</div>
          <div className="stat-label">received so far</div>
        </div>
        <div className="card" style={{ borderTop: '3px solid #3b82f6' }}>
          <div className="card-title">Applied</div>
          <div className="stat-value" style={{ color: '#3b82f6' }}>{stats.applied}</div>
          <div className="stat-label">awaiting response</div>
        </div>
      </div>

      <div className="grid-2">
        {/* Pipeline funnel */}
        <div className="card">
          <div className="section-title">Pipeline Breakdown</div>
          {[
            { label: 'To Do', count: stats.todo, color: '#6366f1' },
            { label: 'Applied', count: stats.applied, color: '#3b82f6' },
            { label: 'Interviewing', count: stats.interviewing, color: '#f59e0b' },
            { label: 'Offer', count: stats.offer, color: '#10b981' },
            { label: 'Rejected', count: stats.rejected, color: '#ef4444' },
          ].map(item => (
            <div key={item.label} style={{ marginBottom: 14 }}>
              <div className="flex items-center justify-between mb-8">
                <span className="text-sm text-muted">{item.label}</span>
                <span className="text-sm font-bold">{item.count}</span>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 99 }}>
                <div style={{
                  height: '100%',
                  width: stats.total ? `${(item.count / stats.total) * 100}%` : '0%',
                  background: item.color,
                  borderRadius: 99,
                  transition: 'width 0.8s ease',
                  boxShadow: `0 0 8px ${item.color}55`,
                }} />
              </div>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm mt-16" onClick={() => setView('kanban')}>
            View Full Board →
          </button>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="section-title">Recent Applications</div>
          {recentApps.length === 0 ? (
            <div className="empty-state" style={{ padding: '30px 0' }}>
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-text">No applications yet</div>
            </div>
          ) : (
            recentApps.map(app => (
              <div key={app.id} className="activity-item">
                <div className="activity-dot" style={{ background: STATUS_COLOR[app.status] }} />
                <div style={{ flex: 1 }}>
                  <div className="text-sm font-bold">{app.company_name}</div>
                  <div className="text-xs text-muted">{app.position_title}</div>
                </div>
                <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>{app.status}</span>
              </div>
            ))
          )}

          {/* Backend health */}
          <div className="divider" />
          <div style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
            <div className="flex items-center gap-8">
              <span className="status-dot" style={!health ? { background: '#ef4444', boxShadow: '0 0 8px #ef4444' } : {}} />
              {health ? `API: ${health.service} · DB: ${health.database}` : 'API Offline'}
            </div>
            {health && <div className="mt-8">Model: {health.groq_model || 'llama3-70b-8192'}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
