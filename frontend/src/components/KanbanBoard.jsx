import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const STAGES = [
  { id: 'todo',         label: 'To Do',        icon: '📝', color: '#6366f1' },
  { id: 'applied',      label: 'Applied',       icon: '📤', color: '#3b82f6' },
  { id: 'interviewing', label: 'Interviewing',   icon: '📞', color: '#f59e0b' },
  { id: 'offer',        label: 'Offer',          icon: '🎉', color: '#10b981' },
  { id: 'rejected',     label: 'Rejected',       icon: '❌', color: '#ef4444' },
];

function AddCard({ onAdd }) {
  const [open, setOpen]     = useState(false);
  const [company, setCompany]   = useState('');
  const [position, setPosition] = useState('');
  const [jd, setJd]         = useState('');
  const [status, setStatus] = useState('todo');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!company || !position) return;
    setLoading(true);
    try {
      await api.createApplication({ company_name: company, position_title: position, job_description: jd, status });
      setCompany(''); setPosition(''); setJd(''); setStatus('todo'); setOpen(false);
      onAdd?.();
    } catch (_) {} finally { setLoading(false); }
  }

  return (
    <div className="mb-24">
      {!open ? (
        <button className="btn btn-secondary" onClick={() => setOpen(true)}>
          ➕ Add Application
        </button>
      ) : (
        <div className="card">
          <div className="section-title">New Application</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label>Company</label>
              <input value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Google" />
            </div>
            <div className="form-group">
              <label>Position</label>
              <input value={position} onChange={e => setPosition(e.target.value)} placeholder="e.g. Software Engineer" />
            </div>
            <div className="form-group">
              <label>Stage</label>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group mb-16">
            <label>Job Description (Optional)</label>
            <textarea style={{ minHeight: 80 }} value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste JD…" />
          </div>
          <div className="flex gap-8">
            <button className="btn btn-primary" onClick={submit} disabled={loading || !company || !position}>
              {loading ? <div className="spinner" /> : '✅ Save Application'}
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function KanbanBoard({ refreshTick }) {
  const [apps, setApps]     = useState([]);
  const [dragging, setDragging] = useState(null);
  const [overCol, setOverCol]   = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.getApplications();
      setApps(d.data || []);
    } catch (_) {}
  }, []);

  useEffect(() => { load(); }, [load, refreshTick]);

  async function moveCard(appId, newStatus) {
    setApps(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a));
    try { await api.updateStatus(appId, newStatus); } catch (_) { load(); }
  }

  async function deleteCard(id) {
    setApps(prev => prev.filter(a => a.id !== id));
    try { await api.deleteApplication(id); } catch (_) { load(); }
  }

  function onDragStart(e, app) {
    setDragging(app);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, stageId) {
    e.preventDefault();
    setOverCol(stageId);
  }

  function onDrop(e, stageId) {
    e.preventDefault();
    if (dragging && dragging.status !== stageId) moveCard(dragging.id, stageId);
    setDragging(null); setOverCol(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">📋 Job Tracker</div>
        <div className="page-subtitle">Drag & drop cards across stages to track your application pipeline</div>
      </div>

      <AddCard onAdd={load} />

      <div className="kanban-board">
        {STAGES.map(stage => {
          const stageApps = apps.filter(a => a.status === stage.id);
          return (
            <div
              key={stage.id}
              className={`kanban-col ${overCol === stage.id ? 'drag-over' : ''}`}
              onDragOver={e => onDragOver(e, stage.id)}
              onDragLeave={() => setOverCol(null)}
              onDrop={e => onDrop(e, stage.id)}
            >
              <div
                className="kanban-col-header"
                style={{ borderBottomColor: stage.color, color: stage.color }}
              >
                <span className="kanban-col-title">{stage.icon} {stage.label}</span>
                <span className="kanban-count">{stageApps.length}</span>
              </div>

              {stageApps.length === 0 && (
                <div className="empty-state" style={{ padding: '40px 8px' }}>
                  <div style={{ fontSize: '1.4rem', opacity: 0.3 }}>📭</div>
                </div>
              )}

              {stageApps.map(app => (
                <div
                  key={app.id}
                  className={`kanban-card ${dragging?.id === app.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={e => onDragStart(e, app)}
                  style={{ borderLeft: `3px solid ${stage.color}` }}
                >
                  <div className="kanban-card-company">{app.company_name}</div>
                  <div className="kanban-card-position">{app.position_title}</div>
                  <div className="kanban-card-date">
                    {app.created_at ? new Date(app.created_at).toLocaleDateString() : ''}
                  </div>
                  <div className="kanban-card-actions">
                    <select
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 8px' }}
                      value={app.status}
                      onChange={e => moveCard(app.id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                    >
                      {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteCard(app.id)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
