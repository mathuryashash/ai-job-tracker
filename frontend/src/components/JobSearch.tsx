import { useState, useEffect } from 'react';
import { api, saveJobsToDB } from '../api/client';
import { useToast } from './Toast';

const PLATFORM_META = {
  linkedin:  { label: 'LinkedIn',  icon: '💼', color: '#0a66c2' },
  indeed:    { label: 'Indeed',    icon: '🔵', color: '#2164f3' },
  glassdoor: { label: 'Glassdoor', icon: '🟢', color: '#0caa41' },
  tinyfish:  { label: 'Tinyfish', icon: '🐟', color: '#6366f1' },
};

export default function JobSearch({ onSaveJob }) {
  const showToast = useToast();
  const [query, setQuery]         = useState(() => localStorage.getItem('target_role') || '');
  const [location, setLocation]   = useState('');
  const [platforms, setPlatforms] = useState(['remoteok', 'usajobs']);
  const [available, setAvailable] = useState([]);
  const [results, setResults]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [searched, setSearched]   = useState(false);
  const [savingId, setSavingId]   = useState(null);

  useEffect(() => {
    api.getPlatforms()
      .then(d => setAvailable(d.platforms || []))
      .catch(() => {});
  }, []);

  function togglePlatform(id) {
    setPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }

  async function handleSearch() {
    if (!query.trim()) { setError('Enter a job title or keywords to search.'); return; }
    if (!platforms.length) { setError('Select at least one platform.'); return; }
    setError(''); setLoading(true); setSearched(true);
    try {
      const data = await api.searchJobs(query, location, platforms, 30);
      setResults(data.jobs || []);
      if (data.errors?.length) setError(data.errors.join(' · '));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveToKanban(job) {
    const id = job.url || job.title + job.company;
    setSavingId(id);
    try {
      await api.createApplication({
        company_name:   job.company,
        position_title: job.title,
        job_description: job.description,
        status: 'todo',
      });
      await saveJobsToDB([{
        title:           job.title,
        company:         job.company,
        location:        job.location,
        description:     job.description,
        url:             job.url,
        platform:        job.platform,
        employment_type: job.employment_type,
        salary:          job.salary,
        posted_date:     job.posted_date,
      }]);
      onSaveJob?.();
      showToast('Saved to tracker ✓', 'success');
    } catch (e) {
      showToast('Failed to save job', 'error');
      setError('Failed to save job: ' + e.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">🔍 Automated Job Search</div>
        <div className="page-subtitle">Free sources: RemoteOK, USAJOBS + LinkedIn/Indeed/Glassdoor via Apify when configured</div>
      </div>

      {/* Search form */}
      <div className="card mb-24">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div className="form-group">
            <label>Job Title / Keywords</label>
            <input
              placeholder="e.g. Senior ML Engineer, React Developer…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            {localStorage.getItem('target_role') && query === localStorage.getItem('target_role') && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge badge-blue">🎯 Auto-filled from resume analysis</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setQuery(''); localStorage.removeItem('target_role'); }}
                  style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                >
                  ✕ Clear
                </button>
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Location</label>
            <input
              placeholder="e.g. San Francisco CA, Remote, New York…"
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
        </div>

        {/* Platform toggles */}
        <div className="mb-16">
          <label style={{ display: 'block', marginBottom: 10 }}>Platforms</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(available.length ? available : Object.keys(PLATFORM_META).map(id => ({ id, enabled: false }))).map(p => {
              const meta = PLATFORM_META[p.id] || { label: p.id, icon: '🌐' };
              return (
                <button
                  key={p.id}
                  className={`platform-toggle ${platforms.includes(p.id) ? 'selected' : ''} ${!p.enabled ? 'disabled' : ''}`}
                  onClick={() => p.enabled && togglePlatform(p.id)}
                  title={!p.enabled ? `Configure API key in Settings to enable ${meta.label}` : meta.label}
                >
                  {meta.icon} {meta.label}
                  {!p.enabled && <span className="badge badge-yellow" style={{ marginLeft: 4, padding: '1px 6px', fontSize: '0.65rem' }}>Setup needed</span>}
                </button>
              );
            })}
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠️ {error}</div>}

        <button
          className="btn btn-primary btn-lg"
          onClick={handleSearch}
          disabled={loading}
          style={{ minWidth: 160 }}
        >
          {loading ? <><div className="spinner" /> Searching…</> : '🔍 Search Jobs'}
        </button>
      </div>

      {/* Results */}
      {loading && (
        <div className="empty-state">
          <div className="spinner spinner-lg" />
          <div className="empty-state-text mt-16">Querying job platforms via Apify…</div>
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🔎</div>
          <div className="empty-state-text">
            No jobs found.<br />
            <span className="text-xs">Make sure APIFY_TOKEN is set in the backend environment, or try different keywords.</span>
          </div>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-16">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {results.length} jobs found
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {results.map((job) => (
              <div key={`${job.platform || 'job'}-${job.url || `${job.title}-${job.company}`}`} className="job-card">
                <div className="job-card-header">
                  <div>
                    <div className="job-card-title">{job.title}</div>
                    <div className="job-card-company">🏢 {job.company}</div>
                  </div>
                  <span className={`badge badge-${job.platform === 'LinkedIn' ? 'blue' : job.platform === 'Indeed' ? 'purple' : 'green'}`}>
                    {PLATFORM_META[job.platform?.toLowerCase()]?.icon} {job.platform}
                  </span>
                </div>

                <div className="job-card-meta">
                  {job.location && <span className="badge badge-yellow">📍 {job.location}</span>}
                  {job.employment_type && <span className="badge badge-blue">⏱ {job.employment_type}</span>}
                  {job.salary && <span className="badge badge-green">💰 {job.salary}</span>}
                  {job.posted_date && <span className="text-xs text-muted">{job.posted_date}</span>}
                </div>

                {job.description && (
                  <div className="job-card-desc">{job.description}</div>
                )}

                <div className="job-card-actions">
                  {job.url && (
                    <a href={job.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                      🔗 View Job
                    </a>
                  )}
                  <button className="btn btn-primary btn-sm" onClick={() => saveToKanban(job)} disabled={!!savingId}>
                    {savingId === (job.url || job.title + job.company) ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Saving…</> : '➕ Save to Tracker'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
